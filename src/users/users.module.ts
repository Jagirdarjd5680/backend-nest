import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsersRecycleBinGateway } from './users-recycle-bin.gateway';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeeRecordsModule } from '../fee-records/fee-records.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || '48fbc47de83da5bedd6f1ae21c176f031a3830372b3b61a876cc4376ca26f6ae1ed4b125c418689e741cd037717b5b3a7',
    }),
    NotificationsModule,
    FeeRecordsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, UsersRecycleBinGateway],
  exports: [UsersService],
})
export class UsersModule {}
