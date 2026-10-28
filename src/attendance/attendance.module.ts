import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { FaceRecognitionService } from './face-recognition.service';

@Module({
  providers: [AttendanceService, FaceRecognitionService],
  controllers: [AttendanceController],
  exports: [AttendanceService],
})
export class AttendanceModule {}
