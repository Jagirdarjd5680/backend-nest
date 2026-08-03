import { SetMetadata } from '@nestjs/common';
import { PermissionAction, PermissionModule } from './module-permissions';

export const MODULE_PERMISSION_KEY = 'modulePermission';

export type ModulePermissionRequirement = { module: PermissionModule; action: PermissionAction };

/**
 * Declares which module + action a route needs. Only ever restricts `teacher`
 * accounts — admins always pass, and roles this isn't relevant to (student, parent)
 * are unaffected regardless of whether they can even reach the route (that's what
 * `@Roles()` is for). See ModulePermissionsGuard.
 */
export const RequireModulePermission = (module: PermissionModule, action: PermissionAction) =>
  SetMetadata(MODULE_PERMISSION_KEY, { module, action } satisfies ModulePermissionRequirement);
