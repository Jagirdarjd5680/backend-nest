import { Module } from '@nestjs/common';
import { ExamResultsService } from './exam-results.service';
import { ExamResultsController } from './exam-results.controller';

@Module({
  providers: [ExamResultsService],
  controllers: [ExamResultsController],
  exports: [ExamResultsService],
})
export class ExamResultsModule {}
