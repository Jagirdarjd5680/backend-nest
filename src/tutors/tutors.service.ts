import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class TutorsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const tutors = await this.prisma.tutor.findMany({
      include: {
        user: true,
      },
    });

    return tutors.map((t) => {
      const profile = (t.tutorProfile as any) || {};
      return {
        ...t,
        ...profile,
        id: t.id,
        _id: t.id,
        name: t.user?.name || profile.name,
        email: t.user?.email || profile.email,
        phone: t.user?.phone || profile.phone,
        profileImage: t.user?.avatar || profile.profileImage || '',
        skills: profile.skills || [],
        charges: {
          perConversation: t.charges || profile.perConversation || 0,
        },
      };
    });
  }

  async findOne(id: number) {
    const t = await this.prisma.tutor.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });
    if (!t) throw new NotFoundException(`Tutor with ID ${id} not found`);

    const profile = (t.tutorProfile as any) || {};
    return {
      ...t,
      ...profile,
      id: t.id,
      _id: t.id,
      name: t.user?.name || profile.name,
      email: t.user?.email || profile.email,
      phone: t.user?.phone || profile.phone,
      profileImage: t.user?.avatar || profile.profileImage || '',
      skills: profile.skills || [],
      charges: {
        perConversation: t.charges || profile.perConversation || 0,
      },
    };
  }

  async create(data: any) {
    let { userId, name, email, phone, skills, experience, description, perConversation, defaultDuration, googleMeetEnabled, status, password, minWithdrawal, tutorId, tokensPerSession, sessionDurationMinutes } = data;

    // If userId is not provided, find by email or create a new user
    if (!userId) {
      let user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        const randomPassword = Math.random().toString(36).slice(-10);
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password || randomPassword, salt);
        user = await this.prisma.user.create({
          data: {
            name,
            email,
            phone,
            password: hashedPassword,
            role: 'tutor',
            isActive: true,
          },
        });
      }
      userId = user.id;
    }

    const perConvFloat = parseFloat(perConversation) || 0;

    const tutorProfile = {
      tutorId: tutorId || 'TUT-' + Math.floor(1000 + Math.random() * 9000),
      name,
      email,
      phone,
      skills: skills || [],
      experience: parseInt(experience, 10) || 0,
      description,
      perConversation: perConvFloat,
      defaultDuration: parseInt(defaultDuration, 10) || 30,
      googleMeetEnabled: googleMeetEnabled === true || googleMeetEnabled === 'true',
      minWithdrawal: parseInt(minWithdrawal, 10) || 5,
    };

    const tutor = await this.prisma.tutor.create({
      data: {
        userId,
        charges: perConvFloat,
        status: status || 'offline',
        tutorProfile,
        tokensPerSession: parseInt(tokensPerSession, 10) || 20,
        sessionDurationMinutes: parseInt(sessionDurationMinutes, 10) || 10,
      },
    });

    return tutor;
  }

  async update(id: number, data: any) {
    const t = await this.prisma.tutor.findUnique({ where: { id } });
    if (!t) throw new NotFoundException(`Tutor with ID ${id} not found`);

    let { name, email, phone, skills, experience, description, perConversation, defaultDuration, googleMeetEnabled, status, password, minWithdrawal, tokensPerSession, sessionDurationMinutes } = data;

    const perConvFloat = parseFloat(perConversation) || 0;
    const existingProfile = (t.tutorProfile as any) || {};

    const tutorProfile = {
      ...existingProfile,
      name: name || existingProfile.name,
      email: email || existingProfile.email,
      phone: phone || existingProfile.phone,
      skills: skills || existingProfile.skills,
      experience: experience !== undefined ? parseInt(experience, 10) : existingProfile.experience,
      description: description !== undefined ? description : existingProfile.description,
      perConversation: perConvFloat || existingProfile.perConversation,
      defaultDuration: defaultDuration !== undefined ? parseInt(defaultDuration, 10) : existingProfile.defaultDuration,
      googleMeetEnabled: googleMeetEnabled !== undefined ? (googleMeetEnabled === true || googleMeetEnabled === 'true') : existingProfile.googleMeetEnabled,
      minWithdrawal: minWithdrawal !== undefined ? parseInt(minWithdrawal, 10) : existingProfile.minWithdrawal,
    };

    const tutor = await this.prisma.tutor.update({
      where: { id },
      data: {
        charges: perConvFloat || undefined,
        status: status || undefined,
        tutorProfile,
        tokensPerSession: tokensPerSession !== undefined ? parseInt(tokensPerSession, 10) : undefined,
        sessionDurationMinutes: sessionDurationMinutes !== undefined ? parseInt(sessionDurationMinutes, 10) : undefined,
      },
    });

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await this.prisma.user.update({
        where: { id: t.userId },
        data: { password: hashedPassword },
      });
    }

    return tutor;
  }

  async remove(id: number) {
    const t = await this.prisma.tutor.findUnique({ where: { id } });
    if (!t) throw new NotFoundException(`Tutor with ID ${id} not found`);

    return this.prisma.tutor.delete({
      where: { id },
    });
  }

  async findDetailed(id: number) {
    const t = await this.prisma.tutor.findUnique({
      where: { id },
      include: {
        user: true,
        withdrawals: true,
        supportSessions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!t) throw new NotFoundException(`Tutor with ID ${id} not found`);

    const completedSessions = t.supportSessions.filter((s) => s.status === 'completed');
    const pendingApprovalSessions = completedSessions.filter((s) => s.earningApprovalStatus === 'pending');

    const stats = {
      totalSessions: t.supportSessions.length,
      completedSessions: completedSessions.length,
      totalEarnings: t.earnings || 0,
      pendingTokens: pendingApprovalSessions.reduce((sum, s) => sum + (s.tokensCost ?? 0), 0),
      totalWithdrawn: t.withdrawals.filter(w => w.status === 'approved').reduce((acc, curr) => acc + curr.amount, 0),
    };

    return {
      success: true,
      tutor: {
        ...t,
        _id: t.id,
        name: t.user?.name,
        email: t.user?.email,
        phone: t.user?.phone,
      },
      stats,
      sessions: t.supportSessions.map((s) => ({ ...s, _id: s.id.toString() })),
      withdrawals: t.withdrawals.map(w => ({ ...w, _id: w.id })),
    };
  }
}
