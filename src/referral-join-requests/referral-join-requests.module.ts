import { Module } from '@nestjs/common';
import { ReferralJoinRequestsService } from './referral-join-requests.service';
import { ReferralJoinRequestsController } from './referral-join-requests.controller';

@Module({
  providers: [ReferralJoinRequestsService],
  controllers: [ReferralJoinRequestsController],
  exports: [ReferralJoinRequestsService],
})
export class ReferralJoinRequestsModule {}
