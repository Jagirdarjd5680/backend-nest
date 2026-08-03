import { ForbiddenException } from '@nestjs/common';

export type Platform = 'web' | 'app';

/**
 * Which client is calling, as sent by the frontend/native-app's request
 * interceptor on every request via the `X-Platform` header (see
 * frontend/src/utils/api.js and native-app/src/lib/apiClient.ts). Used to
 * enforce Course.platformAccess ("web" | "app" | "both").
 *
 * Missing/unrecognized values resolve to `null` rather than defaulting to
 * "web" — an older client build that predates this header should not get
 * silently misclassified and blocked from courses it's actually allowed to see.
 */
export function normalizePlatform(header: string | string[] | undefined): Platform | null {
  const value = Array.isArray(header) ? header[0] : header;
  return value === 'web' || value === 'app' ? value : null;
}

/** Throws the course's platform-specific block message when it doesn't match the caller. */
export function assertCoursePlatformAccess(platformAccess: string, platform: Platform | null): void {
  if (!platformAccess || platformAccess === 'both' || !platform || platformAccess === platform) return;

  const message =
    platformAccess === 'web'
      ? 'This course is only available on the web. Please open it in your browser to continue.'
      : 'This course is only available in the mobile application. Please open the app to continue.';
  throw new ForbiddenException(message);
}
