import { Injectable, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const TOKEN_TTL_SECONDS = 90;

/**
 * Mints and verifies short-lived, per-user, per-file tokens for the /media/file
 * route — deliberately a SEPARATE JwtService/secret from the login JWT (see
 * MediaAccessModule), so a leaked media token can't be replayed as a login
 * session and vice versa. Unlike the login JWT (7 day expiry, reused for every
 * request), each of these is minted for exactly one file path and expires in
 * seconds — sharing a media URL is useless once the token lapses.
 */
@Injectable()
export class MediaAccessService {
  constructor(private readonly jwtService: JwtService) {}

  signMediaToken(userId: number, relativePath: string, ttlSeconds: number = TOKEN_TTL_SECONDS): { token: string; expiresIn: number } {
    const token = this.jwtService.sign({ sub: userId, path: relativePath }, { expiresIn: ttlSeconds });
    return { token, expiresIn: ttlSeconds };
  }

  /** Throws if the token is missing/expired/forged, or was minted for a different file path. */
  verifyMediaToken(token: string, relativePath: string): { userId: number } {
    let payload: { sub: number; path: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new ForbiddenException('Media link has expired. Please reopen it.');
    }
    if (payload.path !== relativePath) {
      throw new ForbiddenException('Media token does not match the requested file.');
    }
    return { userId: payload.sub };
  }
}
