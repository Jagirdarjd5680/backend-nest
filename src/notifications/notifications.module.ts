import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { FcmService } from './fcm.service';
import { ExpoPushService } from './expo-push.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule], // FcmService reads the Firebase key from Settings > Integrations
  providers: [NotificationsService, FcmService, ExpoPushService],
  controllers: [NotificationsController],
  exports: [NotificationsService, FcmService, ExpoPushService],
})
export class NotificationsModule {}
