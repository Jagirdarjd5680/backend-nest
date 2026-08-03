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

    let result: { success: boolean; descriptor?: number[]; message?: string };
    try {
      const res = await fetch(`${PYTHON_AI_SERVICE_URL}/get-descriptor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      result = await res.json();
    } catch (error) {
      this.logger.error(`Face enrollment: python_service unreachable at ${PYTHON_AI_SERVICE_URL}: ${error.message}`);
      throw new BadRequestException('Face recognition service is unavailable right now — please try again later.');
    }

    if (!result.success || !result.descriptor) {
      throw new BadRequestException(result.message || 'No face detected in the photo — please try again.');
    }

    await this.prisma.user.update({ where: { id: userId }, data: { faceDescriptor: result.descriptor } });
    return { success: true, message: 'Face enrolled successfully' };
  }

  /**
   * Real face-recognition check-in. Previously this just marked whichever student
   * happened to be first in the batch's booking list "present" regardless of who (or
   * whether anyone) was actually in the photo — imageBase64 was received and discarded.
   * Now it actually calls python_service's /recognize with the batch's enrolled
   * descriptors and only marks attendance for a real match.
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
    } catch (error) {
      this.logger.error(`Face verification: python_service unreachable at ${PYTHON_AI_SERVICE_URL}: ${error.message}`);
      throw new BadRequestException('Face recognition service is unavailable right now — please try again later.');
    }

    if (!Array.isArray(matches) || matches.length === 0) {
      throw new BadRequestException('Face not recognized — please try again or contact your instructor.');
    }

    const best = matches.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const matchedStudent = candidates.find((u) => String(u.id) === best.student_id);
    if (!matchedStudent) {
      throw new BadRequestException('Face not recognized — please try again or contact your instructor.');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const attendance = await this.prisma.attendance.upsert({
      where: { studentId_batchId_date: { studentId: matchedStudent.id, batchId, date: today } },
      create: { batchId, studentId: matchedStudent.id, status: 'present', date: today },
      update: { status: 'present' },
    });

    return {
      success: true,
      message: `Face verified (${Math.round(best.confidence * 100)}% confidence). Marked attendance for ${matchedStudent.name}`,
      student: {
        id: matchedStudent.id,
        name: matchedStudent.name,
      },
      attendance: {
        ...attendance,
        _id: attendance.id.toString(),
      },
    };
  }
}

