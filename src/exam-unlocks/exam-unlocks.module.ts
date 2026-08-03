import { Module } from '@nestjs/common';
import { ExamUnlocksService } from './exam-unlocks.service';
import { ExamUnlocksController } from './exam-unlocks.controller';

@Module({
  providers: [ExamUnlocksService],
  controllers: [ExamUnlocksController],
  exports: [ExamUnlocksService],
})
export class ExamUnlocksModule {}
