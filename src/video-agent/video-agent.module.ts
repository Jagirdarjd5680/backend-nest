import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VideoAgentController, VideoAgentDeviceController } from './video-agent.controller';
import { VideoAgentGateway } from './video-agent.gateway';
import { VideoAgentService } from './video-agent.service';

/** Windows local video agent — see video-agent.service.ts. Global so UploadsService can cancel jobs on delete. */
@Global()
@Module({
  imports: [PrismaModule, MediaModule, RealtimeModule],
  controllers: [VideoAgentController, VideoAgentDeviceController],
  providers: [VideoAgentService, VideoAgentGateway],
  exports: [VideoAgentService],
})
export class VideoAgentModule {}
