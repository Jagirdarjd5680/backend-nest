import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async searchAll(query: string, type?: string) {
    if (!query || query.trim().length === 0) {
      return { success: true, data: [] };
    }

    const q = query.trim();
    const results: any[] = [];

    if (!type || type === 'user') {
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
          ],
        },
        take: 5,
        select: { id: true, name: true, email: true, role: true, avatar: true },
      });
      users.forEach((u) => {
        results.push({
          type: 'user',
          id: u.id,
          _id: u.id.toString(),
          title: u.name,
          subtitle: u.email,
          badge: u.role,
          url: `/users?openProfile=${u.id}`,
        });
      });
    }

    if (!type || type === 'course') {
      const courses = await this.prisma.course.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { description: { contains: q } },
          ],
        },
        take: 5,
        select: { id: true, title: true, isPublished: true },
      });
      courses.forEach((c) => {
        results.push({
          type: 'course',
          id: c.id,
          _id: c.id.toString(),
          title: c.title,
          subtitle: c.isPublished ? 'Published' : 'Draft',
          badge: 'course',
          url: '/courses',
        });
      });
    }

    if (!type || type === 'exam') {
      const exams = await this.prisma.exam.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { description: { contains: q } },
          ],
        },
        take: 5,
        select: { id: true, title: true, isPublished: true },
      });
      exams.forEach((e) => {
        results.push({
          type: 'exam',
          id: e.id,
          _id: e.id.toString(),
          title: e.title,
          subtitle: e.isPublished ? 'Published' : 'Draft',
          badge: 'exam',
          url: '/exams',
        });
      });
    }

    if (!type || type === 'blog') {
      const blogs = await this.prisma.blog.findMany({
        where: {
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
          ],
        },
        take: 5,
        select: { id: true, title: true, author: true },
      });
      blogs.forEach((b) => {
        results.push({
          type: 'blog',
          id: b.id,
          _id: b.id.toString(),
          title: b.title,
          subtitle: `By ${b.author || 'Admin'}`,
          badge: 'blog',
          url: '/blogs',
        });
      });
    }

    return {
      success: true,
      query: q,
      total: results.length,
      data: results,
    };
  }
}
