import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SessionService } from '../session/session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private usersService: UsersService,
    private sessionService: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || '48fbc47de83da5bedd6f1ae21c176f031a3830372b3b61a876cc4376ca26f6ae1ed4b125c418689e741cd037717b5b3a7',
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if ((user as any).isBlocked) {
      throw new UnauthorizedException('This account has been blocked. Please contact support.');
    }

    // Real enforcement of the single-device policy: once another device logs
    // in, this token's session row is revoked and every subsequent request
    // (not just a client-side popup) starts failing immediately.
    const sessionActive = await this.sessionService.isSessionActive(payload.jti);
    if (!sessionActive) {
      throw new UnauthorizedException('Logged out — this account was signed in on another device.');
    }

    return { ...user, jti: payload.jti };
  }
}
