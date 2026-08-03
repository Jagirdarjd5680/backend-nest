import { Controller, Get, UseGuards } from '@nestjs/common';
import { VideoReviewsService } from './video-reviews.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('video-reviews')
@UseGuards(JwtAuthGuard)
export class VideoReviewsController {
  constructor(private readonly service: VideoReviewsService) {}

  @Get()
  async findAll() {
    return this.service.findAll();
  }
}
