import { Module } from '@nestjs/common';
import { FeeRecordsService } from './fee-records.service';
import { FeeRecordsController } from './fee-records.controller';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SettingsModule, NotificationsModule],
  providers: [FeeRecordsService],
  controllers: [FeeRecordsController],
  exports: [FeeRecordsService],
})
export class FeeRecordsModule {}
