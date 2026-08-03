import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UsersRecycleBinGateway } from './users-recycle-bin.gateway';
import { ExpoPushService } from '../notifications/expo-push.service';
import { NotificationsService } from '../notifications/notifications.service';

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
    return this.prisma.user.findFirst({ where: { phone } });
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
        attendances: {
          include: {
            batch: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    const coursesWithDetails = user.enrollments
      .filter((e) => e.course)
      .map((e) => ({
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
      }));

    const userBatches = user.attendances
      .filter((a) => a.batch)
      .map((a) => a.batch.name);

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
        createdAt: r.createdAt,
        exam: {
          _id: r.examId.toString(),
          id: r.examId,
          title: 'Exam',
        },
      })),
      studentProfile: user.studentProfile || {},
    };
  }

  async create(userData: any): Promise<any> {
    this.logger.log(`[CREATE USER] Received payload: ${JSON.stringify(userData)}`);
    try {
      const { enrolledCourses, batches, autoGeneratePassword, ...rest } = userData;

      // Sanitize empty string unique fields so MySQL does not trigger unique constraint errors on empty strings
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
        const existingPhone = await this.prisma.user.findUnique({
          where: { phone: rest.phone },
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
        const existingPhone = await this.prisma.user.findUnique({
          where: { phone: rest.phone },
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

    // Link user attendance to batch
    for (const batchId of targetBatchIds) {
      const existing = await this.prisma.attendance.findFirst({
        where: { studentId: userId, batchId },
      });

      if (!existing) {
        await this.prisma.attendance.create({
          data: {
            studentId: userId,
            batchId,
            status: 'PRESENT',
            date: new Date(),
          },
        });
      }
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
        { name: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
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

  async updateBiometricFace(userId: number, body: any): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const existingProfile = (user.studentProfile as Record<string, any>) || {};
    const updatedProfile = {
      ...existingProfile,
      faceDescriptor: body?.faceDescriptor || body?.descriptor || body,
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
