import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PYTHON_AI_SERVICE_URL = process.env.PYTHON_AI_SERVICE_URL || 'http://localhost:8000';

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(private prisma: PrismaService) {}

  async findAll() {
    const attendance = await this.prisma.attendance.findMany({
      include: {
        student: true,
        batch: true,
      },
      orderBy: { date: 'desc' },
    });
    return {
      success: true,
      data: attendance.map((a) => ({
        ...a,
        _id: a.id.toString(),
      })),
    };
  }

  async findOne(id: number) {
    const item = await this.prisma.attendance.findUnique({
      where: { id },
      include: {
        student: true,
        batch: true,
      },
    });
    if (!item) throw new NotFoundException(`Attendance with ID ${id} not found`);
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async findByUser(studentId: number) {
    const attendance = await this.prisma.attendance.findMany({
      where: { studentId },
      include: {
        student: true,
        batch: true,
      },
      orderBy: { date: 'desc' },
    });
    return {
      success: true,
      data: attendance.map((a) => ({
        ...a,
        _id: a.id.toString(),
      })),
    };
  }

  async findByBatch(batchId: number) {
    const attendance = await this.prisma.attendance.findMany({
      where: { batchId },
      include: {
        student: {
          select: { id: true, name: true, email: true, phone: true, avatar: true },
        },
        batch: true,
      },
      orderBy: { date: 'desc' },
    });
    const formatted = attendance.map((a) => ({
      ...a,
      _id: a.id.toString(),
      student: a.student ? { ...a.student, _id: a.student.id.toString() } : null,
      batch: a.batch ? { ...a.batch, _id: a.batch.id.toString() } : null,
    }));
    return {
      success: true,
      data: formatted,
    };
  }

  async create(data: any) {
    const item = await this.prisma.attendance.create({ data });
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    const updated = await this.prisma.attendance.update({ where: { id }, data });
    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
    };
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.attendance.delete({ where: { id } });
    return { success: true, message: 'Deleted successfully' };
  }

  /**
   * Enrolls (or re-enrolls) a student's face for the check-in flow below — must run once
   * per student before verifyFaceAttendance can ever match them. Calls python_service's
   * /get-descriptor, which does the actual face_recognition encoding; this backend only
   * stores the resulting 128-float vector.
   */
  async enrollFace(userId: number, imageBase64: string) {
    if (!imageBase64) {
      throw new BadRequestException('No image data provided');
    }

    this.logger.debug(`enrollFace: userId=${userId} imageLen=${imageBase64.length} calling ${PYTHON_AI_SERVICE_URL}/get-descriptor`);

    let result: { success: boolean; descriptor?: number[]; message?: string };
    try {
      const res = await fetch(`${PYTHON_AI_SERVICE_URL}/get-descriptor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      result = await res.json();
      this.logger.debug(
        `enrollFace: python_service responded success=${result.success} descriptorLen=${result.descriptor?.length ?? 0} message=${result.message ?? ''}`,
      );
    } catch (error) {
      this.logger.error(`Face enrollment: python_service unreachable at ${PYTHON_AI_SERVICE_URL}: ${error.message}`);
      throw new BadRequestException('Face recognition service is unavailable right now — please try again later.');
    }

    if (!result.success || !result.descriptor) {
      this.logger.warn(`enrollFace: no descriptor for userId=${userId} — ${result.message}`);
      throw new BadRequestException(result.message || 'No face detected in the photo — please try again.');
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { faceDescriptor: result.descriptor } });
    this.logger.debug(
      `enrollFace: saved faceDescriptor for userId=${userId} (${updated.name}) — stored length=${Array.isArray(updated.faceDescriptor) ? (updated.faceDescriptor as any[]).length : 'n/a'}`,
    );
    return { success: true, message: 'Face enrolled successfully' };
  }

  /**
   * Real face-recognition check-in. Previously this just marked whichever student
   * happened to be first in the batch's booking list "present" regardless of who (or
   * whether anyone) was actually in the photo — imageBase64 was received and discarded.
   * Now it calls python_service's /recognize with ONLY this batch's enrolled descriptors
   * (candidates below), so a face that belongs to a student enrolled in a *different*
   * batch/timing can never match here — e.g. capturing the morning Design batch will
   * never mark the evening Design batch's student present, even if their face was in an
   * earlier frame, because they're simply not in `candidates`.
   *
   * A single camera frame can contain several students. python_service's /recognize
   * returns one result per detected face, so when multiple faces in frame belong to
   * students actually enrolled in this batch, every one of them must be marked present —
   * previously only the single highest-confidence match was recorded and the rest were
   * silently dropped.
   */
  async verifyFaceAttendance(batchId: number, imageBase64: string) {
    if (!imageBase64) {
      throw new BadRequestException('No image data provided');
    }

    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        bookingBatches: { include: { user: true } },
      },
    });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    const candidates = batch.bookingBatches
      .map((b) => b.user)
      .filter((u): u is NonNullable<typeof u> => Boolean(u?.faceDescriptor));

    this.logger.debug(
      `verifyFaceAttendance: batchId=${batchId} enrolledCandidates=${candidates.length} [${candidates.map((c) => `${c.id}:${c.name}`).join(', ')}]`,
    );

    if (candidates.length === 0) {
      throw new BadRequestException('No students in this batch have enrolled their face yet — use the enrollment flow first.');
    }

    let matches: { student_id: string; confidence: number }[];
    try {
      const res = await fetch(`${PYTHON_AI_SERVICE_URL}/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          known_faces: candidates.map((u) => ({ id: String(u.id), descriptor: u.faceDescriptor })),
        }),
      });
      matches = await res.json();
      this.logger.debug(`verifyFaceAttendance: python_service /recognize returned ${JSON.stringify(matches)}`);
    } catch (error) {
      this.logger.error(`Face verification: python_service unreachable at ${PYTHON_AI_SERVICE_URL}: ${error.message}`);
      throw new BadRequestException('Face recognition service is unavailable right now — please try again later.');
    }

    if (!Array.isArray(matches) || matches.length === 0) {
      throw new BadRequestException('Face not recognized — please try again or contact your instructor.');
    }

    // Keep the best confidence per matched student (recognize can return a raw
    // duplicate per detected face if the same person appears more than once in frame).
    const bestByStudent = new Map<string, { student_id: string; confidence: number }>();
    for (const m of matches) {
      const existing = bestByStudent.get(m.student_id);
      if (!existing || m.confidence > existing.confidence) {
        bestByStudent.set(m.student_id, m);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results: {
      student: { _id: string; id: number; name: string; email: string | null };
      attendance: any;
      alreadyMarked: boolean;
      confidence: number;
    }[] = [];

    for (const match of bestByStudent.values()) {
      const matchedStudent = candidates.find((u) => String(u.id) === match.student_id);
      if (!matchedStudent) continue;

      const existing = await this.prisma.attendance.findUnique({
        where: { studentId_batchId_date: { studentId: matchedStudent.id, batchId, date: today } },
      });
      const alreadyMarked = Boolean(existing && existing.status === 'present');

      const attendance = existing
        ? existing
        : await this.prisma.attendance.create({
            data: { batchId, studentId: matchedStudent.id, status: 'present', date: today },
          });
      if (existing && existing.status !== 'present') {
        await this.prisma.attendance.update({ where: { id: existing.id }, data: { status: 'present' } });
      }

      this.logger.debug(
        `verifyFaceAttendance: studentId=${matchedStudent.id} (${matchedStudent.name}) confidence=${match.confidence} alreadyMarked=${alreadyMarked} attendanceId=${attendance.id}`,
      );

      results.push({
        student: {
          _id: String(matchedStudent.id),
          id: matchedStudent.id,
          name: matchedStudent.name,
          email: matchedStudent.email,
        },
        attendance: { ...attendance, _id: attendance.id.toString() },
        alreadyMarked,
        confidence: match.confidence,
      });
    }

    if (results.length === 0) {
      throw new BadRequestException('Face not recognized — please try again or contact your instructor.');
    }

    return {
      success: true,
      message: `Processed ${results.length} recognized student(s)`,
      results,
    };
  }
}

