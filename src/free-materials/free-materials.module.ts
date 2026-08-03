import { Module } from '@nestjs/common';
import { FreeMaterialsService } from './free-materials.service';
import { FreeMaterialsController } from './free-materials.controller';

@Module({
  providers: [FreeMaterialsService],
  controllers: [FreeMaterialsController],
  exports: [FreeMaterialsService],
})
export class FreeMaterialsModule {}
