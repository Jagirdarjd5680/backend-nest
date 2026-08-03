import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionModule } from '../session/session.module';
import { SettingsModule } from '../settings/settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { GamificationModule } from '../gamification/gamification.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './otp.service';

@Module({
  imports: [
    UsersModule,
    PrismaModule,
    SessionModule,
    SettingsModule,
    RealtimeModule,
    GamificationModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || '48fbc47de83da5bedd6f1ae21c176f031a3830372b3b61a876cc4376ca26f6ae1ed4b125c418689e741cd037717b5b3a7',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService, JwtStrategy, OtpService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
