import { Module } from '@nestjs/common';
import { TimetablesService } from './timetables.service';
import { TimetablesController } from './timetables.controller';

@Module({
  providers: [TimetablesService],
  controllers: [TimetablesController],
  exports: [TimetablesService],
})
export class TimetablesModule {}
