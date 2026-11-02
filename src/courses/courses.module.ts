import { Module } from '@nestjs/common';
import { ReviewsModule } from '../reviews/reviews.module';
import { CourseProgressModule } from '../course-progress/course-progress.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CoursesService } from './courses.service';
import { CoursesController } from './courses.controller';

@Module({
  imports: [ReviewsModule, CourseProgressModule, NotificationsModule],
  providers: [CoursesService],
  controllers: [CoursesController],
  exports: [CoursesService],
})
export class CoursesModule {}
