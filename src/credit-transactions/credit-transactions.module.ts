import { Module } from '@nestjs/common';
import { CreditTransactionsService } from './credit-transactions.service';
import { CreditTransactionsController } from './credit-transactions.controller';

@Module({
  providers: [CreditTransactionsService],
  controllers: [CreditTransactionsController],
  exports: [CreditTransactionsService],
})
export class CreditTransactionsModule {}
