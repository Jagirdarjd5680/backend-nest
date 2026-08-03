import { Module } from '@nestjs/common';
import { FeeRecordsService } from './fee-records.service';
import { FeeRecordsController } from './fee-records.controller';

@Module({
  providers: [FeeRecordsService],
  controllers: [FeeRecordsController],
  exports: [FeeRecordsService],
})
export class FeeRecordsModule {}
