import { ForbiddenException, NotFoundException } from '@nestjs/common';

/** Roles that manage other people's data from the admin panels. */
export const STAFF_ROLES = ['admin', 'teacher'];

export const isStaff = (user: any) => STAFF_ROLES.includes(user?.role);

/** Staff may read anyone's records; everyone else only their own. */
export function assertSelfOrStaff(user: any, ownerId: unknown) {
  if (isStaff(user)) return;
  if (ownerId == null || Number(user?.id) !== Number(ownerId)) {
    throw new ForbiddenException('You can only access your own data');
  }
}

/**
 * Same as assertSelfOrStaff for a loaded row. Someone else's row answers 404, not 403, so ids
 * can't be probed to learn which records exist.
 */
export function assertOwnsRow<T>(user: any, row: T | null | undefined, ownerId: (row: T) => unknown): T {
  if (!row) throw new NotFoundException('Not found');
  if (isStaff(user)) return row;
  if (Number(user?.id) !== Number(ownerId(row))) throw new NotFoundException('Not found');
  return row;
}
