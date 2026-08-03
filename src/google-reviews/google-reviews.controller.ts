import { Controller, Get, UseGuards } from '@nestjs/common';
import { GoogleReviewsService } from './google-reviews.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('google-reviews')
@UseGuards(JwtAuthGuard)
export class GoogleReviewsController {
  constructor(private readonly service: GoogleReviewsService) {}

  @Get('fetch')
  async fetchReviews() {
    return this.service.fetchReviews();
  }
}
