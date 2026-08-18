import { Module } from '@nestjs/common';
import { SupportSessionsService } from './support-sessions.service';
import { SupportSessionsController } from './support-sessions.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [SupportSessionsService],
  controllers: [SupportSessionsController],
  exports: [SupportSessionsService],
})
export class SupportSessionsModule {}
