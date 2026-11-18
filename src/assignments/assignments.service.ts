import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourseProgressService } from '../course-progress/course-progress.service';
import { DAY_MS, UnlockContext, evaluateUnlock, openedAt, unlockFieldsFromBody } from '../common/course-unlock';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    private prisma: PrismaService,
    private courseProgressService: CourseProgressService,
  ) {}

  /** Fields every student-facing payload adds: lock state, when it opened, and the personal deadline. */
  private async studentView(a: any, user: { id: number; role?: string }, ctx: UnlockContext) {
    const lock = await evaluateUnlock(this.prisma, a, user.id, a.courseId, ctx);
    let unlockedAt: Date | null = null;
    if (!lock.locked && a.courseId) {
      unlockedAt = await openedAt(this.prisma, a, user.id, a.courseId, ctx, async () => {
        const existing = await this.prisma.assignmentUnlock.findFirst({ where: { studentId: user.id, assignmentId: a.id } });
        if (existing) return existing.unlockedAt;
        return (await this.prisma.assignmentUnlock.create({ data: { studentId: user.id, assignmentId: a.id } })).unlockedAt;
      });
    }
    const mode = a.deadlineMode || 'fixed';
    let deadline: Date | null = null;
    if (mode === 'fixed') deadline = a.dueDate ?? null;
    else if (mode === 'days_after_open' && unlockedAt && a.deadlineDays) deadline = new Date(unlockedAt.getTime() + a.deadlineDays * DAY_MS);
    return {
      isLocked: lock.locked,
      lockReason: lock.reason,
      unlockedAt,
      deadline,
      deadlineDays: mode === 'days_after_open' ? a.deadlineDays ?? 0 : 0,
      noDeadline: mode === 'course_end',
    };
  }

  /** Form settings (marks, type, upload limits, attachments, published) from a create/update body. */
  private settingsFields(data: any) {
    const out: Record<string, any> = {};
    const num = (v: any) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
    if (num(data.totalMarks) !== undefined) out.totalMarks = num(data.totalMarks);
    if (typeof data.assignmentType === 'string' && data.assignmentType) out.assignmentType = data.assignmentType;
    if (num(data.maxMb) !== undefined) out.maxMb = Math.trunc(num(data.maxMb)!);
    if (typeof data.allowedFormats === 'string' && data.allowedFormats) out.allowedFormats = data.allowedFormats;
    if (Array.isArray(data.attachments)) out.attachments = data.attachments;
    // '' clears the cover image, undefined leaves it alone.
    if (typeof data.thumbnail === 'string') out.thumbnail = data.thumbnail || null;
    if (typeof data.isPublished === 'boolean') out.isPublished = data.isPublished;
    return out;
  }

  /** Deadline / lock fields written by the admin form (only keys that were actually sent). */
  private deadlineFields(data: any) {
    const out: Record<string, any> = {};
    if (!data || !('deadlineMode' in data)) return out;
    const mode = ['fixed', 'days_after_open', 'course_end'].includes(data.deadlineMode) ? data.deadlineMode : 'fixed';
    const days = Number(data.deadlineDays);
    out.deadlineMode = mode;
    out.deadlineDays = mode === 'days_after_open' && Number.isFinite(days) && days > 0 ? Math.trunc(days) : null;
    // `dueDate` is NOT NULL in the table: a course assignment gets a far-future placeholder (the real
    // deadline is computed per student), so old screens never show a bogus "overdue".
    if (mode !== 'fixed' && !data.dueDate) out.dueDate = new Date(Date.now() + 5 * 365 * DAY_MS);
    return out;
  }

  /** The quiz questions of an assignment (answer key only for staff), in the admin's order. */
  private async questionsFor(a: { questionIds?: unknown }, isStaff: boolean) {
    const ids = Array.isArray(a.questionIds) ? (a.questionIds as any[]).map((n) => Number(n)).filter((n) => Number.isInteger(n)) : [];
    if (ids.length === 0) return [];
    const rows = await this.prisma.question.findMany({ where: { id: { in: ids }, isDeleted: false } });
    const byId = new Map(rows.map((q) => [q.id, q]));
    return ids
      .map((id) => byId.get(id))
      .filter((q): q is NonNullable<typeof q> => !!q)
      .map(({ correctOption, explanation, ...q }) => (isStaff ? { ...q, correctOption, explanation, _id: q.id.toString() } : { ...q, _id: q.id.toString() }));
  }

  /** "Select questions" on a quiz assignment (admin/teacher): replaces its question list. */
  async setAssignmentQuestions(id: number, questionIds: any[]) {
    const existing = await this.prisma.assignment.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException(`Assignment with ID ${id} not found`);
    const wanted = (Array.isArray(questionIds) ? questionIds : []).map((n) => parseInt(String(n), 10)).filter((n) => Number.isInteger(n));
    const valid = await this.prisma.question.findMany({ where: { id: { in: wanted }, isDeleted: false }, select: { id: true } });
    const validSet = new Set(valid.map((q) => q.id));
    const ordered = [...new Set(wanted)].filter((n) => validSet.has(n));
    await this.prisma.assignment.update({ where: { id }, data: { questionIds: ordered } });
    return { success: true, data: { assignmentId: id, questionIds: ordered } };
  }

  // Assignment CRUD
  async findAllAssignments(courseId?: number, user?: { id: number; role?: string }) {
    const items = await this.prisma.assignment.findMany({
      where: courseId ? { courseId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const isStudent = user?.role === 'student';
    const ctx = new UnlockContext();
    const data = await Promise.all(
      items.map(async (i) => {
        // Staff see everything; a student sees the lock state and personal deadline of their own course progress.
        const questions = await this.questionsFor(i, !isStudent);
        if (!isStudent) return { ...i, _id: i.id.toString(), isLocked: false, lockReason: null, questions };
        const view = await this.studentView(i, user!, ctx);
        return { ...i, _id: i.id.toString(), ...view, questions };
      }),
    );
    return { success: true, data };
  }

  async findOneAssignment(id: number, user?: { id: number; role?: string }) {
    const item = await this.prisma.assignment.findUnique({
      where: { id },
      include: {
        submissions: {
          include: { student: { select: { id: true, name: true, email: true, rollNumber: true } } },
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
    if (!item) throw new NotFoundException(`Assignment with ID ${id} not found`);
    const { submissions, ...assignment } = item;
    let view: Record<string, any> = { isLocked: false, lockReason: null };
    if (user?.role === 'student') {
      view = await this.studentView(assignment, user, new UnlockContext());
      if (view.isLocked) throw new ForbiddenException(view.lockReason || 'This assignment is locked');
    }
    return {
      success: true,
      data: {
        ...assignment,
        _id: assignment.id.toString(),
        ...view,
        questions: await this.questionsFor(assignment, user?.role !== 'student'),
        submissions: submissions.map((s) => ({ ...s, _id: s.id.toString() })),
      },
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
          select: { id: true, name: true, email: true, avatar: true, rollNumber: true },
        },
        assignment: { select: { id: true, title: true, totalMarks: true, courseId: true } },
      },
    });

    const formatted = submissions.map((sub) => ({
      _id: sub.id.toString(),
      id: sub.id,
      student: sub.student ? { ...sub.student, _id: sub.student.id.toString() } : null,
      assignment: sub.assignment ? { ...sub.assignment, _id: sub.assignment.id.toString() } : null,
      // Flat copies for the header bell + dashboard widget, which read these names directly.
      studentName: sub.student?.name ?? 'Deleted student',
      studentImage: sub.student?.avatar ?? '',
      assignmentTitle: sub.assignment?.title ?? '',
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
    console.log(`🐛 [AssignmentUpload] assignmentId=${assignmentId} studentId=${studentId} fileUrl=${data?.fileUrl} textAnswer=${data?.textAnswer ? '(present)' : '(empty)'}`);
    try {
      const assignment = await this.findOneAssignment(assignmentId, { id: studentId, role: 'student' });

      // "N days after it opens" deadlines are enforced; "course_end" never expires.
      const info: any = assignment.data;
      const dl = info.deadline ? new Date(info.deadline) : null;
      if (info.deadlineMode === 'days_after_open' && dl && Date.now() > dl.getTime()) {
        throw new ForbiddenException('The deadline for this assignment has passed');
      }

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

      console.log(`🐛 [AssignmentUpload] saved submissionId=${submission.id} savedFileUrl=${submission.fileUrl}`);

      // This submission may be the last thing standing between the student and 95%
      // weighted course progress — completeLecture() already auto-issues in that case,
      // but a submission crossing the threshold otherwise never triggered it.
      if (assignment.data.courseId) {
        await this.courseProgressService.maybeAutoIssueCertificate(studentId, assignment.data.courseId);
      }

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
        courseId: data.courseId ? parseInt(data.courseId, 10) : undefined,
        ...unlockFieldsFromBody(data),
        ...this.deadlineFields(data),
        ...this.settingsFields(data),
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
        ...unlockFieldsFromBody(data),
        ...this.deadlineFields(data),
        ...this.settingsFields(data),
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
