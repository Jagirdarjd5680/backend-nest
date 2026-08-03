import { Module } from '@nestjs/common';
import { BatchMaterialsService } from './batch-materials.service';
import { BatchMaterialsController } from './batch-materials.controller';

@Module({
  providers: [BatchMaterialsService],
  controllers: [BatchMaterialsController],
  exports: [BatchMaterialsService],
})
export class BatchMaterialsModule {}
