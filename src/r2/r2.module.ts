import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MediaModule } from '../media/media.module';
import { R2Controller } from './r2.controller';
import { R2DevController } from './r2-dev.controller';
import { R2Service } from './r2.service';

/**
 * R2 storage integration — see r2.service.ts for how to remove it.
 * Global so UploadsService can inject it with @Optional() without importing this module.
 */
@Global()
@Module({
  imports: [PrismaModule, MediaModule], // MediaModule: only for the dev page's video playback
  // R2DevController = local-only test page at /api/r2/dev
  controllers: [R2DevController, R2Controller],
  providers: [R2Service],
  exports: [R2Service],
})
export class R2Module {}
