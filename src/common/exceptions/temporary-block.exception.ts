import { ForbiddenException } from '@nestjs/common';

/**
 * Thrown by any 60s cooldown (multi-device login strikes, OTP-send spam, …) so every caller and
 * the client get the exact same response shape: a friendly message plus the fixed expiry to
 * count down to. Re-hitting the endpoint during the cooldown must keep returning this same
 * `blockedUntil`, never a freshly-extended one — that's what lets the client's countdown survive
 * app close/reopen and repeated taps without resetting.
 */
export class TemporaryBlockException extends ForbiddenException {
  constructor(message: string, public readonly blockedUntil: Date) {
    super({ message, blockedUntil: blockedUntil.toISOString(), code: 'TEMP_BLOCKED' });
  }
}
