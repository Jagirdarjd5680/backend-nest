import { Module } from '@nestjs/common';
import { SeatBookingsService } from './seat-bookings.service';
import { SeatBookingsController } from './seat-bookings.controller';

@Module({
  providers: [SeatBookingsService],
  controllers: [SeatBookingsController],
  exports: [SeatBookingsService],
})
export class SeatBookingsModule {}
