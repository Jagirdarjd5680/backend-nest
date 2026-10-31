import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FaceMatch, FaceRecognitionService } from './face-recognition.service';


@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private prisma: PrismaService,
    private faces: FaceRecognitionService,
  ) {}

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

  /** Midnight (server time) — the exact `date` every attendance row for "today" is stored with. */
  private today() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** `onlyToday` limits to today's rows; without it every day of the batch is returned. */
  async findByBatch(batchId: number, onlyToday = false) {
    const attendance = await this.prisma.attendance.findMany({
      where: onlyToday ? { batchId, date: this.today() } : { batchId },
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

  /**
   * Manual present/absent for today (staff tapping a student). Upserts on the same
   * (student, batch, today) key face check-in uses, so the two never create duplicates
   * and the client never has to agree with the server on what "today" is.
   */
  async markManual(batchId: number, studentId: number, status: 'present' | 'absent') {
    const date = this.today();
    const row = await this.prisma.attendance.upsert({
      where: { studentId_batchId_date: { studentId, batchId, date } },
      create: { batchId, studentId, date, status },
      update: { status },
    });
    return { success: true, data: { ...row, _id: row.id.toString() } };
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
   * per student before verifyFaceAttendance can ever match them. FaceRecognitionService
   * turns the photo into a 128-float descriptor, which is stored on the user.
   */
  async enrollFace(userId: number, imageBase64: string) {
    if (!imageBase64) {
      throw new BadRequestException('No image data provided');
    }

    let descriptor: number[] | null;
    try {
      descriptor = await this.faces.descriptor(imageBase64);
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Face enrollment failed: ${error?.message}`);
      throw new BadRequestException('Face recognition failed — please try again.');
    }
    if (!descriptor) {
      this.logger.warn(`enrollFace: no face found for userId=${userId} (imageLen=${imageBase64.length})`);
      throw new BadRequestException('No face detected in the photo — please try again.');
    }

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { faceDescriptor: descriptor } });
    this.logger.debug(
      `enrollFace: saved faceDescriptor for userId=${userId} (${updated.name}) — stored length=${Array.isArray(updated.faceDescriptor) ? (updated.faceDescriptor as any[]).length : 'n/a'}`,
    );
    return { success: true, message: 'Face enrolled successfully' };
  }

  /**
   * Real face-recognition check-in. Previously this just marked whichever student
   * happened to be first in the batch's booking list "present" regardless of who (or
   * whether anyone) was actually in the photo — imageBase64 was received and discarded.
   * Now it runs FaceRecognitionService.recognize with ONLY this batch's enrolled descriptors
   * (candidates below), so a face that belongs to a student enrolled in a *different*
   * batch/timing can never match here — e.g. capturing the morning Design batch will
   * never mark the evening Design batch's student present, even if their face was in an
   * earlier frame, because they're simply not in `candidates`.
   *
   * A single camera frame can contain several students. recognize() returns one result
   * per recognised face, so when multiple faces in frame belong to
   * students actually enrolled in this batch, every one of them must be marked present —
   * previously only the single highest-confidence match was recorded and the rest were
   * silently dropped.
   */
  async verifyFaceAttendance(batchId: number, imageBase64: string) {
    if (!imageBase64) {
      throw new BadRequestException('No image data provided');
    }

    const batch = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    // Same membership rule as BatchesService.memberWhere (the batch's student list):
    // booked into the batch OR already has attendance in it. Using only bookingBatches
    // here meant a student shown on the batch page could never be recognized at check-in.
    const members = await this.prisma.user.findMany({
      where: {
        role: 'student',
        isDeleted: false,
        OR: [{ bookingBatches: { some: { batchId } } }, { attendances: { some: { batchId } } }],
      },
    });
    const candidates = members.filter((u) => Array.isArray(u.faceDescriptor) && (u.faceDescriptor as any[]).length === 128);

    this.logger.debug(
      `verifyFaceAttendance: batchId=${batchId} enrolledCandidates=${candidates.length} [${candidates.map((c) => `${c.id}:${c.name}`).join(', ')}]`,
    );

    if (candidates.length === 0) {
      throw new BadRequestException('No students in this batch have enrolled their face yet — use the enrollment flow first.');
    }

    let matches: FaceMatch[];
    try {
      matches = await this.faces.recognize(
        imageBase64,
        candidates.map((u) => ({ id: String(u.id), descriptor: u.faceDescriptor as number[] })),
      );
      this.logger.debug(`verifyFaceAttendance: recognize returned ${JSON.stringify(matches)}`);
    } catch (error: any) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Face verification failed: ${error?.message}`);
      throw new BadRequestException('Face recognition failed — please try again.');
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

      // An existing absent/late row is flipped to present — return the updated row, not the stale one.
      const attendance = !existing
        ? await this.prisma.attendance.create({
            data: { batchId, studentId: matchedStudent.id, status: 'present', date: today },
          })
        : existing.status !== 'present'
          ? await this.prisma.attendance.update({ where: { id: existing.id }, data: { status: 'present' } })
          : existing;

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

