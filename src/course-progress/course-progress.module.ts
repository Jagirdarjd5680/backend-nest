import { Module } from '@nestjs/common';
import { CourseProgressService } from './course-progress.service';
import { CourseProgressController } from './course-progress.controller';
import { CertificatesModule } from '../certificates/certificates.module';

@Module({
  imports: [CertificatesModule],
  providers: [CourseProgressService],
  controllers: [CourseProgressController],
  exports: [CourseProgressService],
})
export class CourseProgressModule {}
