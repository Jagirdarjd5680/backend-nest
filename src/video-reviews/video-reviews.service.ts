import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VideoReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const mediaVideos = await this.prisma.media.findMany({
      where: {
        type: 'video',
        status: 'ready',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return {
      success: true,
      data: mediaVideos.map((v) => ({
        ...v,
        _id: v.id.toString(),
      })),
      message: 'Video reviews retrieved successfully',
    };
  }
}
