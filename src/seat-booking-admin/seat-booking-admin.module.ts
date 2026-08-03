import { Module } from '@nestjs/common';
import { SeatBookingAdminService } from './seat-booking-admin.service';
import { SeatBookingAdminController } from './seat-booking-admin.controller';

@Module({
  providers: [SeatBookingAdminService],
  controllers: [SeatBookingAdminController],
  exports: [SeatBookingAdminService],
})
export class SeatBookingAdminModule {}
