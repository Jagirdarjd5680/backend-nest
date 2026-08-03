import { Module } from '@nestjs/common';
import { SupportSessionsService } from './support-sessions.service';
import { SupportSessionsController } from './support-sessions.controller';

@Module({
  providers: [SupportSessionsService],
  controllers: [SupportSessionsController],
  exports: [SupportSessionsService],
})
export class SupportSessionsModule {}
