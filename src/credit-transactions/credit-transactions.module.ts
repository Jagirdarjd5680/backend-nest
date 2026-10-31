import { Module } from '@nestjs/common';
import { CreditTransactionsService } from './credit-transactions.service';
import { CreditTransactionsController } from './credit-transactions.controller';
import { CreditPurchaseService } from './credit-purchase.service';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PaymentsModule, SettingsModule],
  providers: [CreditTransactionsService, CreditPurchaseService],
  controllers: [CreditTransactionsController],
  exports: [CreditTransactionsService],
})
export class CreditTransactionsModule {}
