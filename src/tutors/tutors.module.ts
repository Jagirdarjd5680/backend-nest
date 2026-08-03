import { Module } from '@nestjs/common';
import { TutorsService } from './tutors.service';
import { TutorsController } from './tutors.controller';

@Module({
  providers: [TutorsService],
  controllers: [TutorsController],
  exports: [TutorsService],
})
export class TutorsModule {}
