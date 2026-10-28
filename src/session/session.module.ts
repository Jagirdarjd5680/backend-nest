import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { GamificationModule } from '../gamification/gamification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SessionService } from './session.service';
import { SessionGateway } from './session.gateway';
import { SessionController } from './session.controller';

@Module({
  imports: [
    PrismaModule,
    GamificationModule,
    NotificationsModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || '48fbc47de83da5bedd6f1ae21c176f031a3830372b3b61a876cc4376ca26f6ae1ed4b125c418689e741cd037717b5b3a7',
    }),
  ],
  providers: [SessionService, SessionGateway],
  controllers: [SessionController],
  exports: [SessionService, SessionGateway],
})
export class SessionModule {}
