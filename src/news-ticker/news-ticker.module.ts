import { Module } from '@nestjs/common';
import { NewsTickerService } from './news-ticker.service';
import { NewsTickerController } from './news-ticker.controller';

@Module({
  providers: [NewsTickerService],
  controllers: [NewsTickerController],
  exports: [NewsTickerService],
})
export class NewsTickerModule {}
