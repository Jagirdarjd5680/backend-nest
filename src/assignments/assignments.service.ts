import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(private prisma: PrismaService) {}

  // Assignment CRUD
  async findAllAssignments(courseId?: number) {
    const items = await this.prisma.assignment.findMany({
      where: courseId ? { courseId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: items.map((i) => ({ ...i, _id: i.id.toString() })),
    };
  }

  async findOneAssignment(id: number) {
    const item = await this.prisma.assignment.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Assignment with ID ${id} not found`);
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async findBatchSubmissions(batchId: number) {
    const batch = await this.prisma.batch.findUnique({
      where: { id: batchId },
      include: { course: true },
    });

    let students = await this.prisma.user.findMany({
      where: {
        role: 'student',
        isDeleted: false,
        attendances: {
          some: { batchId },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        rollNumber: true,
        avatar: true,
      },
    });

    // Fallback: if no attendance records yet, fetch any student
    if (students.length === 0) {
      students = await this.prisma.user.findMany({
        where: { role: 'student', isDeleted: false },
        take: 20,
        select: {
          id: true,
          name: true,
          email: true,
          rollNumber: true,
          avatar: true,
        },
      });
    }

    const assignments = await this.prisma.assignment.findMany({
      where: { batchId },
      orderBy: { createdAt: 'desc' },
    });

    const studentIds = students.map((s) => s.id);
    const submissions = await this.prisma.assignmentSubmission.findMany({
      where: { studentId: { in: studentIds } },
    });

    const studentsData = students.map((student) => {
      const studentSubmissions = submissions
        .filter((sub) => sub.studentId === student.id)
        .map((sub) => {
          const assignment = assignments.find((a) => a.id === sub.assignmentId);
          return {
            _id: sub.id.toString(),
            id: sub.id,
            assignmentId: sub.assignmentId.toString(),
            assignmentTitle: assignment?.title || 'Assignment',
            submittedAt: sub.submittedAt,
            fileUrl: sub.fileUrl,
            textAnswer: sub.textAnswer,
            quizAnswers: sub.quizAnswers,
            status: sub.status,
            grade: sub.grade,
            feedback: sub.feedback || '',
          };
        });

      return {
        _id: student.id.toString(),
        name: student.name,
        email: student.email,
        rollNumber: student.rollNumber || 'N/A',
        profileImage: student.avatar || '',
        submissions: studentSubmissions,
      };
    });

    const formattedAssignments = assignments.map((a) => ({
      ...a,
      _id: a.id.toString(),
    }));

    return {
      success: true,
      data: {
        batchId: batchId.toString(),
        batchName: batch?.name || 'Cohort Batch',
        assignments: formattedAssignments,
        students: studentsData,
      },
    };
  }

  async findAllSubmissions(limit: number = 10) {
    const submissions = await this.prisma.assignmentSubmission.findMany({
      take: limit,
      orderBy: { submittedAt: 'desc' },
      include: {
        student: {
          select: { id: true, name: true, email: true, avatar: true },
        },
        assignment: true,
      },
    });

    const formatted = submissions.map((sub) => ({
      _id: sub.id.toString(),
      id: sub.id,
      student: sub.student ? { ...sub.student, _id: sub.student.id.toString() } : null,
      assignment: sub.assignment ? { ...sub.assignment, _id: sub.assignment.id.toString() } : null,
      fileUrl: sub.fileUrl,
      textAnswer: sub.textAnswer,
      quizAnswers: sub.quizAnswers,
      submittedAt: sub.submittedAt,
      status: sub.status,
      grade: sub.grade,
      feedback: sub.feedback,
    }));

    return {
      success: true,
      data: formatted,
    };
  }

  async submitAssignment(assignmentId: number, studentId: number, data: any) {
    try {
      await this.findOneAssignment(assignmentId);

      const submission = await this.prisma.assignmentSubmission.create({
        data: {
          assignmentId,
          studentId,
          fileUrl: data.fileUrl || '',
          textAnswer: data.textAnswer || '',
          quizAnswers: data.quizAnswers ? data.quizAnswers : undefined,
          status: 'pending',
        },
      });

      return {
        success: true,
        data: { ...submission, _id: submission.id.toString() },
        message: 'Assignment submitted successfully',
      };
    } catch (error) {
      // Rethrown as-is below (so the client still gets the correct status/message) —
      // this is purely so a failed submit is never silent in the backend terminal,
      // whether it's a 404 (bad assignmentId), a Prisma constraint error, or anything else.
      this.logger.error(
        `submitAssignment failed — assignmentId=${assignmentId} studentId=${studentId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  async gradeSubmission(submissionId: number, data: any) {
    const existing = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
    });
    if (!existing) {
      throw new NotFoundException(`Submission with ID ${submissionId} not found`);
    }

    const updated = await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: {
        grade: parseFloat(data.grade),
        feedback: data.feedback || '',
        status: data.status || 'graded',
      },
    });

    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
      message: 'Grade submitted successfully',
    };
  }

  async createAssignment(data: any) {
    const item = await this.prisma.assignment.create({
      data: {
        title: data.title,
        description: data.description || '',
        filePath: data.filePath || '',
        dueDate: data.dueDate ? new Date(data.dueDate) : new Date(),
      },
    });
    return {
      success: true,
      data: { ...item, _id: item.id.toString() },
    };
  }

  async updateAssignment(id: number, data: any) {
    await this.findOneAssignment(id);
    const updated = await this.prisma.assignment.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        filePath: data.filePath,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        // Checking for the key's presence (not truthiness) so `courseId: null` — unlinking
        // an assignment from a course — actually persists instead of being treated the same
        // as "field not sent" and silently no-op'd.
        courseId: 'courseId' in data ? (data.courseId === null ? null : parseInt(data.courseId, 10)) : undefined,
      },
    });
    return {
      success: true,
      data: { ...updated, _id: updated.id.toString() },
    };
  }

  async removeAssignment(id: number) {
    await this.findOneAssignment(id);
    await this.prisma.assignment.delete({ where: { id } });
    return { success: true, message: 'Assignment deleted successfully' };
  }

  // AssignmentUnlock CRUD
  async findAllUnlocks() {
    const unlocks = await this.prisma.assignmentUnlock.findMany({
      include: { student: true },
    });
    return {
      success: true,
      data: unlocks.map((u) => ({ ...u, _id: u.id.toString() })),
    };
  }

  async unlockAssignment(data: any) {
    const unlock = await this.prisma.assignmentUnlock.create({
      data: {
        studentId: parseInt(data.studentId, 10),
        assignmentId: parseInt(data.assignmentId, 10),
      },
    });
    return {
      success: true,
      data: { ...unlock, _id: unlock.id.toString() },
    };
  }

  // BatchMaterial CRUD
  async findAllMaterials() {
    const materials = await this.prisma.batchMaterial.findMany({ include: { batch: true } });
    return {
      success: true,
      data: materials.map((m) => ({ ...m, _id: m.id.toString() })),
    };
  }

  async createMaterial(data: any) {
    const material = await this.prisma.batchMaterial.create({
      data: {
        title: data.title || data.name,
        filePath: data.filePath || data.url || '',
        batchId: parseInt(data.batchId || data.batch, 10),
      },
    });
    return {
      success: true,
      data: { ...material, _id: material.id.toString() },
    };
  }
}
