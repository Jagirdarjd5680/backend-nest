import { Module } from '@nestjs/common';
import { WithdrawRequestsService } from './withdraw-requests.service';
import { WithdrawRequestsController } from './withdraw-requests.controller';

@Module({
  providers: [WithdrawRequestsService],
  controllers: [WithdrawRequestsController],
  exports: [WithdrawRequestsService],
})
export class WithdrawRequestsModule {}
