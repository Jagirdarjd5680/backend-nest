import { Module } from '@nestjs/common';
import { BookingBatchesService } from './booking-batches.service';
import { BookingBatchesController } from './booking-batches.controller';

@Module({
  providers: [BookingBatchesService],
  controllers: [BookingBatchesController],
  exports: [BookingBatchesService],
})
export class BookingBatchesModule {}
