import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';
import * as path from 'path';
import { UsersRecycleBinGateway } from './users-recycle-bin.gateway';
import { ExpoPushService } from '../notifications/expo-push.service';
import { NotificationsService } from '../notifications/notifications.service';
import { normalizePhone, phoneLookupVariants } from '../common/phone.util';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

const allowedUserFields = [
  'name',
  'email',
  'password',
  'googleId',
  'role',
  'phone',
  'address',
  'avatar',
  'twoFactorEnabled',
  'isActive',
  'isDeleted',
  'authMethod',
  'source',
  'rollNumber',
  'permissions',
  'modulePermissions',
  'studentProfile',
];

function filterUserFields(data: any): any {
  const filtered: any = {};
  for (const key of allowedUserFields) {
    if (data[key] !== undefined) {
      filtered[key] = data[key];
    }
  }
  return filtered;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private recycleBinGateway: UsersRecycleBinGateway,
    private expoPushService: ExpoPushService,
    private notificationsService: NotificationsService,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(id: number): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.prisma.user.findFirst({ where: { phone: { in: phoneLookupVariants(phone) } } });
  }

  async findByIdDetails(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        examResults: true,
        enrollments: {
          include: {
            course: true,
          },
        },
        bookingBatches: {
          include: {
            batch: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    // Real per-course exam/assignment counts + how many this student has actually completed —
    // CourseTab.jsx renders these as chips but they were never populated (always 0/0), so this
    // is what makes "kitne exam diye / assignment kiye" show real numbers instead of fake ones.
    const courseIds = user.enrollments.filter((e) => e.course).map((e) => e.courseId);
    const [examsByCourseRaw, assignmentsByCourseRaw, examResultsByExam, submittedAssignmentIds, examTitlesById] = await Promise.all([
      courseIds.length ? this.prisma.exam.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, courseId: true } }) : [],
      courseIds.length ? this.prisma.assignment.findMany({ where: { courseId: { in: courseIds } }, select: { id: true, courseId: true } }) : [],
      this.prisma.examResult.findMany({ where: { studentId: id }, select: { examId: true }, distinct: ['examId'] }),
      this.prisma.assignmentSubmission.findMany({ where: { studentId: id }, select: { assignmentId: true }, distinct: ['assignmentId'] }),
      this.prisma.exam.findMany({ where: { id: { in: user.examResults.map((r) => r.examId) } }, select: { id: true, title: true } }),
    ]);
    const attemptedExamIds = new Set(examResultsByExam.map((r) => r.examId));
    const examTitleMap = new Map(examTitlesById.map((e) => [e.id, e.title]));
    const submittedAssignmentIdSet = new Set(submittedAssignmentIds.map((s) => s.assignmentId));

    const coursesWithDetails = user.enrollments
      .filter((e) => e.course)
      .map((e) => {
        const courseExams = examsByCourseRaw.filter((ex) => ex.courseId === e.courseId);
        const courseAssignments = assignmentsByCourseRaw.filter((a) => a.courseId === e.courseId);
        return {
          _id: e.courseId.toString(),
          id: e.courseId,
          title: e.course.title,
          thumbnail: e.course.thumbnail,
          price: e.course.price,
          progress: 0,
          paymentProgress: 100,
          activationDate: e.createdAt,
          expiryDate: null,
          certificate: null,
          examCount: courseExams.length,
          examsAttempted: courseExams.filter((ex) => attemptedExamIds.has(ex.id)).length,
          assignmentCount: courseAssignments.length,
          assignmentsSubmitted: courseAssignments.filter((a) => submittedAssignmentIdSet.has(a.id)).length,
        };
      });

    // Batch assignment is BookingBatch (the real enrollment/assignment table — see
    // timetables.service.ts/batch-materials.service.ts for the same pattern), not Attendance.
    // The old code derived "assigned batch" from whether a PRESENT attendance row happened to
    // exist, which is both why the edit form's batch field never autofilled for a student who
    // hadn't attended a class yet, and why assigning a batch used to fabricate a fake PRESENT
    // attendance record that polluted real attendance history.
    const userBatches = user.bookingBatches
      .filter((bb) => bb.batch)
      .map((bb) => bb.batch.name);

    const enrolledCourseIds = user.enrollments.map((e) => e.courseId.toString());

    const { password, ...safeUser } = user as any;

    return {
      ...safeUser,
      _id: user.id.toString(),
      id: user.id,
      enrolledCourses: enrolledCourseIds,
      batches: userBatches,
      coursesWithDetails,
      examResults: user.examResults.map((r) => ({
        _id: r.id.toString(),
        id: r.id,
        score: r.score,
        maxScore: r.maxScore,
        passed: r.passed,
        createdAt: r.createdAt,
        exam: {
          _id: r.examId.toString(),
          id: r.examId,
          title: examTitleMap.get(r.examId) || 'Exam',
        },
      })),
      studentProfile: user.studentProfile || {},
    };
  }

  async create(userData: any): Promise<any> {
    this.logger.log(`[CREATE USER] Received payload: ${JSON.stringify(userData)}`);
    try {
      const { enrolledCourses, batches, autoGeneratePassword, ...rest } = userData;

      // Sanitize empty string unique fields so the database does not trigger unique constraint errors on empty strings
      for (const field of ['phone', 'googleId', 'rollNumber', 'referralCode']) {
        if (rest[field] === '' || rest[field] === null || rest[field] === undefined) {
          delete rest[field];
        }
      }

      if (rest.email) {
        rest.email = rest.email.toLowerCase().trim();
        const existingUser = await this.findByEmail(rest.email);
        if (existingUser) {
          this.logger.warn(`[CREATE USER FAILED] Email already exists: ${rest.email}`);
          throw new BadRequestException('Email already exists');
        }
      }

      if (rest.phone) {
        rest.phone = normalizePhone(rest.phone);
        const existingPhone = await this.prisma.user.findFirst({
          where: { phone: { in: phoneLookupVariants(rest.phone) } },
        });
        if (existingPhone) {
          this.logger.warn(`[CREATE USER FAILED] Phone already exists: ${rest.phone}`);
          throw new BadRequestException('Phone number already exists');
        }
      }

      if (rest.password) {
        const salt = await bcrypt.genSalt(10);
        rest.password = await bcrypt.hash(rest.password, salt);
      } else if (autoGeneratePassword || rest.role === 'student' || !rest.password) {
        const rawPass = Math.random().toString(36).slice(-8);
        const salt = await bcrypt.genSalt(10);
        rest.password = await bcrypt.hash(rawPass, salt);
      }

      if (rest.role === 'student' && !rest.rollNumber) {
        rest.rollNumber = 'ROLL-' + Math.floor(100000 + Math.random() * 900000).toString();
      }

      const filteredData = filterUserFields(rest);
      this.logger.log(`[CREATE USER] Filtered data for Prisma: ${JSON.stringify(filteredData)}`);

      const user = await this.prisma.user.create({
        data: filteredData,
      });

      if (enrolledCourses && enrolledCourses.length > 0) {
        const validCourseIds = enrolledCourses
          .map((c: any) => parseInt(String(c?._id || c?.id || c), 10))
          .filter((c: number) => !isNaN(c));

        if (validCourseIds.length > 0) {
          await this.prisma.enrollment.createMany({
            data: validCourseIds.map((courseId: number) => ({
              userId: user.id,
              courseId,
            })),
          });

          for (const courseId of validCourseIds) {
            this.notifyCourseAssigned(user.id, courseId).catch((err) =>
              this.logger.error(`[CREATE USER] Course-assignment notification failed for user ${user.id}, course ${courseId}: ${err.message}`),
            );
          }
        }
      }

      if (batches && batches.length > 0) {
        await this.assignBatchesToUser(user.id, batches);
      }

      const formatted = {
        ...user,
        _id: user.id.toString(),
      };
      this.logger.log(`[CREATE USER SUCCESS] User created with ID: ${user.id}`);
      return formatted;
    } catch (error: any) {
      this.logger.error(`[CREATE USER ERROR] ${error.message}`, error.stack);
      throw error;
    }
  }

  async update(id: number, data: any): Promise<any> {
    this.logger.log(`[UPDATE USER] Updating User ID ${id} with payload: ${JSON.stringify(data)}`);
    try {
      const { enrolledCourses, batches, ...rest } = data;

      // Sanitize empty string unique fields
      for (const field of ['phone', 'googleId', 'rollNumber', 'referralCode']) {
        if (rest[field] === '' || rest[field] === null) {
          delete rest[field];
        }
      }

      if (rest.email) {
        rest.email = rest.email.toLowerCase().trim();
        const existingUser = await this.findByEmail(rest.email);
        if (existingUser && existingUser.id !== id) {
          this.logger.warn(`[UPDATE USER FAILED] Email already in use by user ${existingUser.id}: ${rest.email}`);
          throw new BadRequestException('Email already in use');
        }
      }

      if (rest.phone) {
        rest.phone = normalizePhone(rest.phone);
        const existingPhone = await this.prisma.user.findFirst({
          where: { phone: { in: phoneLookupVariants(rest.phone) } },
        });
        if (existingPhone && existingPhone.id !== id) {
          this.logger.warn(`[UPDATE USER FAILED] Phone already in use by user ${existingPhone.id}: ${rest.phone}`);
          throw new BadRequestException('Phone number already in use');
        }
      }

      if (rest.password) {
        const salt = await bcrypt.genSalt(10);
        rest.password = await bcrypt.hash(rest.password, salt);
      } else {
        delete rest.password;
      }

      const filteredData = filterUserFields(rest);
      this.logger.log(`[UPDATE USER] Filtered data for Prisma: ${JSON.stringify(filteredData)}`);

      const user = await this.prisma.user.update({
        where: { id },
        data: filteredData,
      });

      if (enrolledCourses !== undefined) {
        const existingEnrollments = await this.prisma.enrollment.findMany({
          where: { userId: id },
          select: { courseId: true },
        });
        const previousCourseIds = new Set(existingEnrollments.map((e) => e.courseId));

        await this.prisma.enrollment.deleteMany({
          where: { userId: id },
        });

        if (Array.isArray(enrolledCourses) && enrolledCourses.length > 0) {
          const validCourseIds = enrolledCourses
            .map((c: any) => parseInt(String(c?._id || c?.id || c), 10))
            .filter((c: number) => !isNaN(c));

          if (validCourseIds.length > 0) {
            await this.prisma.enrollment.createMany({
              data: validCourseIds.map((courseId: number) => ({
                userId: id,
                courseId,
              })),
            });
          }

          // Courses the admin just newly assigned (weren't enrolled before this update) —
          // these are manual/offline assignments (no payment flow), so notify the student
          // directly instead of leaving them to discover it silently.
          const newlyAssignedCourseIds = validCourseIds.filter((cId) => !previousCourseIds.has(cId));
          for (const courseId of newlyAssignedCourseIds) {
            this.notifyCourseAssigned(id, courseId).catch((err) =>
              this.logger.error(`[UPDATE USER] Course-assignment notification failed for user ${id}, course ${courseId}: ${err.message}`),
            );
          }
        }
      }

      if (batches !== undefined) {
        await this.assignBatchesToUser(id, batches);
      }

      const formatted = {
        ...user,
        _id: user.id.toString(),
      };
      this.logger.log(`[UPDATE USER SUCCESS] User updated with ID: ${id}`);
      return formatted;
    } catch (error: any) {
      this.logger.error(`[UPDATE USER ERROR] ${error.message}`, error.stack);
      throw error;
    }
  }

  private async notifyCourseAssigned(userId: number, courseId: number): Promise<void> {
    const course = await this.prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
    if (!course) return;

    const title = '🎉 Course Assigned!';
    const message = `Congratulations! You've been assigned to "${course.title}". Start learning now.`;

    console.log(`🎓 [CourseAssign] Notifying user=${userId} course="${course.title}" (id=${courseId})`);

    await this.notificationsService.create({
      title,
      message,
      type: 'course_assigned',
      recipientRole: 'student',
      recipients: [userId],
    });

    const pushResult = await this.expoPushService.sendToUser(userId, title, message, { courseId });
    if (pushResult.success) {
      console.log(`✅ [CourseAssign] Push sent to user=${userId} for course="${course.title}"`);
    } else {
      console.warn(`🚫 [CourseAssign] Push NOT sent to user=${userId} (${pushResult.reason ?? 'no token'})`);
    }
  }

  private async assignBatchesToUser(userId: number, batches: any[]) {
    if (!Array.isArray(batches)) return;

    // Resolve batch IDs from names or IDs
    const allBatches = await this.prisma.batch.findMany();
    const targetBatchIds: number[] = [];

    batches.forEach((bVal: any) => {
      const bStr = String(bVal?._id || bVal?.id || bVal);
      const match = allBatches.find(
        (b) => b.id.toString() === bStr || b.name.toLowerCase() === bStr.toLowerCase(),
      );
      if (match && !targetBatchIds.includes(match.id)) {
        targetBatchIds.push(match.id);
      }
    });

    // Full replace, same semantics as enrolledCourses above — BookingBatch is the real
    // batch-assignment table (also what timetables/batch-materials read from), not a fabricated
    // attendance record.
    await this.prisma.bookingBatch.deleteMany({ where: { userId } });
    if (targetBatchIds.length > 0) {
      await this.prisma.bookingBatch.createMany({
        data: targetBatchIds.map((batchId) => ({ userId, batchId })),
        skipDuplicates: true,
      });
    }
  }

  async findAll(options: {
    role?: string;
    search?: string;
    page?: number;
    limit?: number;
    isDeleted?: string;
  }) {
    const { role, search, page, limit, isDeleted } = options;

    const where: any = {};

    if (isDeleted === 'true') {
      where.isDeleted = true;
    } else if (isDeleted === 'false' || !isDeleted) {
      where.isDeleted = false;
    }

    if (role && role !== 'all') {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const take = limit ? Number(limit) : undefined;
    const skip = page && limit ? (Number(page) - 1) * Number(limit) : undefined;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    const formattedUsers = users.map((u) => ({
      ...u,
      _id: u.id.toString(),
    }));

    return {
      success: true,
      data: formattedUsers,
      total,
      page: page || 1,
      limit: limit || users.length,
    };
  }

  /** Media Library's "Face Registrations" tab — every user with a real enrolled face
   * descriptor (attendance.service.ts's enrollFace), paired with the display thumbnail
   * saved alongside it (studentProfile.biometricFace) so admins can spot-check whose face
   * is on file without exposing the raw 128-float recognition vector. */
  async getFaceRegistrations() {
    // Prisma's Json? "not null" filtering is unreliable across how null vs JsonNull got
    // stored historically, so filter in JS instead of trusting a `where` clause here.
    const users = await this.prisma.user.findMany({
      where: { isDeleted: false },
      select: { id: true, name: true, email: true, avatar: true, rollNumber: true, studentProfile: true, updatedAt: true, faceDescriptor: true },
      orderBy: { updatedAt: 'desc' },
    });

    return users
      .filter((u) => u.faceDescriptor)
      .map((u) => ({
        _id: u.id.toString(),
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        rollNumber: u.rollNumber,
        biometricFace: (u.studentProfile as any)?.biometricFace || null,
        registeredAt: u.updatedAt,
      }));
  }

  async getBinCount(): Promise<number> {
    return this.prisma.user.count({
      where: { isDeleted: true },
    });
  }

  async getBinAll(): Promise<any[]> {
    const users = await this.prisma.user.findMany({
      where: { isDeleted: true },
      orderBy: { updatedAt: 'desc' },
    });
    return users.map((u) => ({
      ...u,
      _id: u.id.toString(),
    }));
  }

  async restoreUser(id: number): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { isDeleted: false },
    });
    this.recycleBinGateway.emitRecycleBinChange('restored', 1);
    return user;
  }

  async permanentDelete(id: number): Promise<User> {
    const deleted = await this.prisma.user.delete({
      where: { id },
    });
    this.recycleBinGateway.emitRecycleBinChange('permanently_deleted', 1);
    return deleted;
  }

  async updateStudentProfile(userId: number, profileData: any): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const existingProfile = (user.studentProfile as Record<string, any>) || {};
    const updatedProfile = {
      ...existingProfile,
      ...profileData,
    };

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        studentProfile: updatedProfile,
      },
    });
  }

  /** Self-service name edit — deliberately its own narrow method (not the admin PUT /users/:id
   * path, and not folded into updateStudentProfile's JSON blob) so a student can only ever touch
   * their own `name` column, nothing else. */
  async updateOwnName(userId: number, name: string): Promise<User> {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new BadRequestException('Name cannot be empty.');
    if (trimmed.length > 100) throw new BadRequestException('Name is too long.');
    return this.prisma.user.update({ where: { id: userId }, data: { name: trimmed } });
  }

  /** Deletes the old avatar's physical file (only ever an internal `/uploads/...` path this
   * server wrote — Google-login avatars are external URLs and must never be touched here) once
   * the new one is safely saved, so replaced avatars don't pile up as orphaned files forever. */
  private deleteOldAvatarFile(oldAvatar: string | null | undefined) {
    if (!oldAvatar || !oldAvatar.startsWith('/uploads/')) return;
    try {
      const filePath = path.join(UPLOADS_DIR, oldAvatar.replace(/^\/uploads\//, '').split('?')[0]);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup — a failed unlink shouldn't block the avatar change itself.
    }
  }

  async updateAvatar(userId: number, file: { buffer: Buffer; mimetype: string; size: number; originalname: string }): Promise<User> {
    if (!file) throw new BadRequestException('No image uploaded.');
    if (!AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only PNG or JPEG images are allowed.');
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException('Image must be 1MB or smaller.');
    }

    const user = await this.findById(userId);
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
    const fileName = `avatar_${userId}_${Date.now()}.${ext}`;
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), file.buffer);

    const updated = await this.prisma.user.update({ where: { id: userId }, data: { avatar: `/uploads/${fileName}` } });
    this.deleteOldAvatarFile(user.avatar);
    return updated;
  }

  async findLatestEnrollmentCourseId(userId: number): Promise<number | null> {
    const latest = await this.prisma.enrollment.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { courseId: true },
    });
    return latest?.courseId ?? null;
  }

  /** Admin-only "set/change password" — separate from the self-service reset-token flow in
   * AuthService, which requires the student to already have email access. */
  async setPassword(userId: number, newPassword: string): Promise<{ success: boolean; message: string }> {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Password must be at least 6 characters.');
    }
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    return { success: true, message: `Password updated for ${user.name}` };
  }

  /** Every assignment visible to this student (via enrolled courses / assigned batches), each
   * paired with their submission if one exists — SubmissionsTab.jsx needs the full set (not just
   * submitted ones) so it can show "MISSING" for assignments never turned in. Was a stub
   * returning [] before, so this tab always read empty regardless of real activity. */
  async getSubmissionsForUser(userId: number) {
    const [enrollments, bookingBatches] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { userId }, select: { courseId: true } }),
      this.prisma.bookingBatch.findMany({ where: { userId }, select: { batchId: true } }),
    ]);
    const courseIds = enrollments.map((e) => e.courseId);
    const batchIds = bookingBatches.map((b) => b.batchId);
    if (courseIds.length === 0 && batchIds.length === 0) return { success: true, data: [] };

    const assignments = await this.prisma.assignment.findMany({
      where: {
        OR: [
          courseIds.length ? { courseId: { in: courseIds } } : undefined,
          batchIds.length ? { batchId: { in: batchIds } } : undefined,
        ].filter(Boolean) as any,
      },
      include: { submissions: { where: { studentId: userId } } },
    });

    const [courses, batches] = await Promise.all([
      this.prisma.course.findMany({ where: { id: { in: assignments.map((a) => a.courseId).filter((x): x is number => x != null) } }, select: { id: true, title: true } }),
      this.prisma.batch.findMany({ where: { id: { in: assignments.map((a) => a.batchId).filter((x): x is number => x != null) } }, select: { id: true, name: true } }),
    ]);
    const courseTitleMap = new Map(courses.map((c) => [c.id, c.title]));
    const batchNameMap = new Map(batches.map((b) => [b.id, b.name]));

    const data = assignments.map((a) => {
      const sub = a.submissions[0];
      return {
        assignmentId: a.id,
        title: a.title,
        course: a.courseId ? courseTitleMap.get(a.courseId) || 'General' : 'General',
        batch: a.batchId ? batchNameMap.get(a.batchId) || 'General' : 'General',
        submitted: !!sub,
        submissionDetails: sub
          ? {
              _id: sub.id.toString(),
              submittedAt: sub.submittedAt,
              fileUrl: sub.fileUrl,
              textAnswer: sub.textAnswer,
              status: sub.status,
              grade: sub.grade,
              feedback: sub.feedback,
            }
          : null,
      };
    });

    return { success: true, data };
  }

  /**
   * Preview-only: stores a single thumbnail image so the admin UI's "Currently Registered"
   * circle has something to show. FaceCapture.jsx reads `studentProfile.biometricFace` for
   * that thumbnail; this used to write the payload under the key `faceDescriptor` instead
   * (and never unwrapped the `imagesBase64` array the frontend actually sends), so the key
   * name never matched what was being read back and the preview stayed permanently blank
   * even after a successful enrollment. Real recognition data lives in the User.faceDescriptor
   * column, written by AttendanceService.enrollFace — this is display-only.
   */
  async updateBiometricFace(userId: number, body: any): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const thumbnail = body?.imagesBase64?.[0] || body?.biometricFace || body?.faceImageUrl || null;

    const existingProfile = (user.studentProfile as Record<string, any>) || {};
    const updatedProfile = {
      ...existingProfile,
      biometricFace: thumbnail,
    };

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        studentProfile: updatedProfile,
      },
    });
  }

  async remove(id: number): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true },
    });
    this.recycleBinGateway.emitRecycleBinChange('archived', 1);
    return user;
  }

  async bulkArchive(ids: number[]): Promise<{ count: number }> {
    const result = await this.prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { isDeleted: true },
    });
    this.recycleBinGateway.emitRecycleBinChange('archived', result.count);
    return { count: result.count };
  }

  async delete(id: number): Promise<void> {
    await this.remove(id);
  }

  async toggleActive(id: number, isActive: boolean): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
    });
  }

  // ─── Biometric ──────────────────────────────────────────────────────────
  async registerBiometric(userId: number, faceImageUrl: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    // Store face image URL in student profile JSON
    const profile = (user.studentProfile as any) || {};
    profile.faceImageUrl = faceImageUrl;
    profile.biometricRegistered = true;

    await this.prisma.user.update({
      where: { id: userId },
      data: { studentProfile: profile },
    });

    return { success: true, message: 'Biometric data registered successfully' };
  }

  async verifyBiometric(userId: number, faceImageUrl: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const profile = (user.studentProfile as any) || {};

    // Simple URL-based match (in production: integrate face recognition API)
    const isMatch = profile.faceImageUrl === faceImageUrl && profile.biometricRegistered === true;

    return {
      success: true,
      verified: isMatch,
      message: isMatch ? 'Biometric verification successful' : 'Face does not match registered data',
    };
  }

  // ─── Registration Approval ──────────────────────────────────────────────
  async getPendingRegistrations() {
    const users = await this.prisma.user.findMany({
      where: { isActive: false, isDeleted: false },
      select: { id: true, name: true, email: true, role: true, phone: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: users.map((u) => ({ ...u, _id: u.id.toString() })) };
  }

  async approveRegistration(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    return { success: true, message: `Registration approved for ${user.name}` };
  }

  async rejectRegistration(userId: number, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException(`User with ID ${userId} not found`);

    const profile = (user.studentProfile as any) || {};
    profile.rejectionReason = reason || 'Rejected by admin';

    await this.prisma.user.update({
      where: { id: userId },
      data: { isDeleted: true, studentProfile: profile },
    });

    return { success: true, message: `Registration rejected for ${user.name}` };
  }
}
