import { Module } from '@nestjs/common';
import { LiveClassesService } from './live-classes.service';
import { LiveClassesController } from './live-classes.controller';

@Module({
  providers: [LiveClassesService],
  controllers: [LiveClassesController],
  exports: [LiveClassesService],
})
export class LiveClassesModule {}
