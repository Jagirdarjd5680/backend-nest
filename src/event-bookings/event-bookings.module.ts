import { Module } from '@nestjs/common';
import { EventBookingsService } from './event-bookings.service';
import { EventBookingsController } from './event-bookings.controller';

@Module({
  providers: [EventBookingsService],
  controllers: [EventBookingsController],
  exports: [EventBookingsService],
})
export class EventBookingsModule {}
