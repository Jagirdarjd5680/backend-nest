import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [ChatModule],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
