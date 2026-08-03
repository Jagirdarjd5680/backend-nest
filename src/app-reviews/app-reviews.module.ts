import { Module } from '@nestjs/common';
import { AppReviewsService } from './app-reviews.service';
import { AppReviewsController } from './app-reviews.controller';

@Module({
  providers: [AppReviewsService],
  controllers: [AppReviewsController],
  exports: [AppReviewsService],
})
export class AppReviewsModule {}
