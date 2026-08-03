import { Module } from '@nestjs/common';
import { PlacementsService } from './placements.service';
import { PlacementsController } from './placements.controller';

@Module({
  providers: [PlacementsService],
  controllers: [PlacementsController],
  exports: [PlacementsService],
})
export class PlacementsModule {}
