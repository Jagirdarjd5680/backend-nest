import { Module } from '@nestjs/common';
import { PassedStudentsService } from './passed-students.service';
import { PassedStudentsController } from './passed-students.controller';

@Module({
  providers: [PassedStudentsService],
  controllers: [PassedStudentsController],
  exports: [PassedStudentsService],
})
export class PassedStudentsModule {}
