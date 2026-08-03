import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from './pdf.service';
import { IssueCertificateDto } from './dto/issue-certificate.dto';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class CertificatesService {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
  ) {}

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

    const { fileName } = await this.pdfService.generateCertificatePDF(
      student,
      course,
      { certificateId, pin, issueDate },
    );

    const pdfUrl = `/uploads/certificates/${fileName}`;

    const certificate = await this.prisma.certificate.create({
      data: {
        title: `${course.certificateName || course.title} - Completion Certificate`,
        certificateId,
        pin,
        pdfUrl,
        issueDate,
        userId: dto.studentId,
        courseId: dto.courseId,
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
      data: certificates.map((c) => ({ ...c, _id: c.id.toString() })),
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

    let filePath = path.join(process.cwd(), certificate.pdfUrl);

    // If PDF file doesn't exist on disk, regenerate it dynamically
    if (!fs.existsSync(filePath)) {
      const student = certificate.user;
      const course = certificate.course || { title: certificate.title };
      const { fileName, filePath: newPath } = await this.pdfService.generateCertificatePDF(
        student,
        course,
        {
          certificateId: certificate.certificateId,
          pin: certificate.pin,
          issueDate: certificate.issueDate,
        },
      );
      filePath = newPath;
      await this.prisma.certificate.update({
        where: { id: certificate.id },
        data: { pdfUrl: `/uploads/certificates/${fileName}` },
      });
    }

    return { filePath, fileName: path.basename(filePath) };
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
    return this.prisma.certificate.delete({ where: { id } });
  }
}
