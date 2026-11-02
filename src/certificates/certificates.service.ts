import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from './pdf.service';
import { IssueCertificateDto, CertificateFieldsDto } from './dto/issue-certificate.dto';

const FIELDS = ['studentName', 'courseName', 'duration', 'grade', 'specialization'] as const;
type Fields = Partial<Record<(typeof FIELDS)[number], string | null>>;

/** Only the non-empty, trimmed fields the admin typed (null for the ones cleared). */
function cleanFields(input: Partial<Record<string, unknown>>): Fields {
  const out: Fields = {};
  for (const k of FIELDS) {
    if (input[k] === undefined) continue;
    const v = String(input[k] ?? '').trim();
    out[k] = v ? v : null;
  }
  return out;
}
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class CertificatesService {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
  ) {}

  /** Duration (the course's reading time) and grade (average of the student's exam scores). */
  private async certificateDetails(studentId: number, course: { id: number; readingDurationValue?: number; readingDurationUnit?: string }) {
    const value = course.readingDurationValue || 0;
    const unit = course.readingDurationUnit || 'hours';
    const duration = value > 0 ? `${value} ${unit.charAt(0).toUpperCase()}${unit.slice(1)}` : undefined;

    const results = await this.prisma.examResult.findMany({
      where: { studentId, exam: { courseId: course.id } },
      select: { examId: true, score: true, maxScore: true },
      orderBy: { score: 'desc' },
    });
    // Best attempt per exam.
    const best = new Map<number, number>();
    for (const r of results) {
      if (!r.maxScore || best.has(r.examId)) continue;
      best.set(r.examId, (r.score / r.maxScore) * 100);
    }
    let grade: string | undefined;
    if (best.size) {
      const avg = [...best.values()].reduce((a, b) => a + b, 0) / best.size;
      grade = avg >= 90 ? 'A+' : avg >= 80 ? 'A' : avg >= 70 ? 'B+' : avg >= 60 ? 'B' : avg >= 50 ? 'C' : 'D';
    }
    return { duration, grade };
  }

  /**
   * What gets printed: admin-typed values first (saved on the certificate, or sent with a preview),
   * else the live ones — student's current name, course title, reading time, exam-based grade.
   */
  private async printedFields(studentId: number, student: { name: string }, course: any, ...layers: Fields[]) {
    const live: { duration?: string; grade?: string } = course?.id ? await this.certificateDetails(studentId, course) : {};
    const base: Record<string, string | undefined> = {
      studentName: student.name,
      courseName: (course?.title || '').trim(),
      duration: live.duration,
      grade: live.grade,
      specialization: undefined,
    };
    for (const layer of layers) {
      for (const k of FIELDS) if (layer?.[k]) base[k] = layer[k] as string;
    }
    return base as { studentName: string; courseName: string; duration?: string; grade?: string; specialization?: string };
  }

  private renderWith(fields: Awaited<ReturnType<CertificatesService['printedFields']>>, meta: { certificateId: string; issueDate: Date; pin?: string }) {
    return { student: { name: fields.studentName }, course: { title: fields.courseName }, meta: { ...meta, duration: fields.duration, grade: fields.grade, specialization: fields.specialization } };
  }

  /** Values for the admin's certificate Edit form: live defaults plus anything already saved. */
  async getCertificateForm(studentId: number, courseId: number) {
    const [student, course, existing] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: studentId } }),
      this.prisma.course.findUnique({ where: { id: courseId } }),
      this.prisma.certificate.findFirst({ where: { userId: studentId, courseId } }),
    ]);
    if (!student || !course) throw new NotFoundException('Student or Course not found');
    const defaults = await this.printedFields(studentId, student, course);
    const values = await this.printedFields(studentId, student, course, existing ?? {});
    return {
      success: true,
      data: {
        defaults,
        values: { ...values, specialization: values.specialization ?? '' },
        certificate: existing ? { ...existing, _id: existing.id.toString() } : null,
      },
    };
  }

  /** Admin preview: the real layout, rendered on the fly with the form's values — never issued or saved. */
  async previewCertificate(studentId: number, courseId: number, fields: CertificateFieldsDto = {}): Promise<Buffer> {
    const [student, course] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: studentId } }),
      this.prisma.course.findUnique({ where: { id: courseId } }),
    ]);
    if (!student || !course) throw new NotFoundException('Student or Course not found');
    const existing = await this.prisma.certificate.findFirst({ where: { userId: studentId, courseId } });
    const printed = await this.printedFields(studentId, student, course, existing ?? {}, cleanFields(fields as any));
    const r = this.renderWith(printed, { certificateId: existing?.certificateId || 'PREVIEW', issueDate: existing?.issueDate || new Date() });
    return this.pdfService.renderCertificate(r.student, r.course, r.meta);
  }

  async issueCertificate(dto: IssueCertificateDto) {
    const student = await this.prisma.user.findUnique({
      where: { id: dto.studentId },
    });
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!student || !course) {
      throw new NotFoundException('Student or Course not found');
    }

    // One certificate per student per course — issuing again saves the Edit form's values onto it.
    const typed = cleanFields(dto as any);
    const existing = await this.prisma.certificate.findFirst({ where: { userId: dto.studentId, courseId: dto.courseId } });
    if (existing) {
      const updated = Object.keys(typed).length
        ? await this.prisma.certificate.update({ where: { id: existing.id }, data: typed })
        : existing;
      return {
        success: true,
        message: Object.keys(typed).length ? 'Certificate details updated' : 'Certificate already issued',
        data: { ...updated, _id: updated.id.toString() },
      };
    }

    const progressRecord = await this.prisma.courseProgress.findUnique({
      where: {
        studentId_courseId: {
          studentId: dto.studentId,
          courseId: dto.courseId,
        },
      },
    });

    // Check completion progress (95% required unless forced by admin)
    if (!dto.force) {
      let progressPercent = 0;
      if (progressRecord && progressRecord.completedLessons) {
        try {
          const completedArr = JSON.parse(progressRecord.completedLessons);
          const totalLessons = await this.prisma.lesson.count({ where: { courseId: dto.courseId } });
          if (totalLessons > 0) {
            progressPercent = Math.round((completedArr.length / totalLessons) * 100);
          }
        } catch (e) {
          progressPercent = 0;
        }
      }

      if (progressPercent < 95) {
        throw new BadRequestException(`Student has only reached ${progressPercent}% progress. 95% required to issue certificate.`);
      }
    }

    const certificateId = `CERT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const issueDate = new Date();

    const printed = await this.printedFields(dto.studentId, student, course, typed);
    const r = this.renderWith(printed, { certificateId, pin, issueDate });
    const { fileName } = await this.pdfService.generateCertificatePDF(r.student, r.course, r.meta);

    const pdfUrl = `/uploads/certificates/${fileName}`;

    const certificate = await this.prisma.certificate.create({
      data: {
        title: `${course.title.trim()} - Completion Certificate`,
        certificateId,
        pin,
        pdfUrl,
        issueDate,
        userId: dto.studentId,
        courseId: dto.courseId,
        ...typed,
      },
    });

    return {
      success: true,
      message: 'Certificate issued successfully',
      data: {
        ...certificate,
        _id: certificate.id.toString(),
      },
    };
  }

  async getMyCertificates(userId: number) {
    const certificates = await this.prisma.certificate.findMany({
      where: { userId },
      include: {
        course: {
          select: { id: true, title: true, thumbnail: true },
        },
      },
      orderBy: { issueDate: 'desc' },
    });

    return {
      success: true,
      // Name from the admin's edit, else the course's current title (older rows stored the
      // course form's "Certificate Title", e.g. "testcf - Completion Certificate").
      data: certificates.map((c) => ({
        ...c,
        _id: c.id.toString(),
        title: c.courseName || c.course?.title?.trim() ? `${c.courseName || c.course!.title.trim()} - Completion Certificate` : c.title,
      })),
    };
  }

  async getCourseCertificate(userId: number, courseId: number) {
    const certificate = await this.prisma.certificate.findFirst({
      where: { userId, courseId },
      include: { course: true },
    });

    if (!certificate) {
      throw new NotFoundException('Certificate not found for this course');
    }

    return {
      success: true,
      data: { ...certificate, _id: certificate.id.toString() },
    };
  }

  async getCertificateFile(id: number, userId: number, role: string) {
    const certificate = await this.prisma.certificate.findUnique({
      where: { id },
      include: { user: true, course: true },
    });

    if (!certificate) throw new NotFoundException('Certificate not found');

    if (certificate.userId !== userId && role !== 'admin') {
      throw new ForbiddenException('Unauthorized to access this certificate');
    }

    // Re-rendered on every download so it always uses the current design, the admin's current
    // certificate settings (signature, signatory, institute) and the student's current name.
    const oldPath = certificate.pdfUrl ? path.join(process.cwd(), certificate.pdfUrl) : null;
    const course = certificate.course || { title: certificate.title.replace(/ - Completion Certificate$/, '') };
    const printed = await this.printedFields(certificate.userId, certificate.user, course, certificate);
    const r = this.renderWith(printed, { certificateId: certificate.certificateId, pin: certificate.pin, issueDate: certificate.issueDate });
    const { fileName, filePath } = await this.pdfService.generateCertificatePDF(r.student, r.course, r.meta);
    await this.prisma.certificate.update({
      where: { id: certificate.id },
      data: { pdfUrl: `/uploads/certificates/${fileName}` },
    });
    if (oldPath && oldPath !== filePath && fs.existsSync(oldPath)) {
      try {
        fs.unlinkSync(oldPath);
      } catch {}
    }

    return { filePath, fileName: `Certificate-${certificate.certificateId}.pdf` };
  }

  async findAll() {
    const items = await this.prisma.certificate.findMany({
      include: {
        user: true,
        course: true,
      },
    });
    return {
      success: true,
      data: items.map((c) => ({ ...c, _id: c.id.toString() })),
    };
  }

  async findOne(id: number) {
    const item = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        user: true,
        course: true,
      },
    });
    if (!item) throw new NotFoundException(`Certificate with ID ${id} not found`);
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async create(data: any) {
    return this.prisma.certificate.create({ data });
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.certificate.update({ where: { id }, data });
  }

  async remove(id: number) {
    const item = await this.prisma.certificate.findUnique({ where: { id } });
    if (item && item.pdfUrl) {
      const filePath = path.join(process.cwd(), item.pdfUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await this.prisma.certificate.delete({ where: { id } });
    return { success: true, message: 'Certificate cancelled' };
  }
}
