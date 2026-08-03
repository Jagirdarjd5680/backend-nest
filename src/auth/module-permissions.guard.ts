import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MODULE_PERMISSION_KEY, ModulePermissionRequirement } from './module-permissions.decorator';
import { hasModulePermission } from './module-permissions';

/**
 * Enforces the per-module (view/add/edit/delete) grants stored on `user.modulePermissions`.
 * Deliberately only restricts `teacher` accounts: admins bypass entirely, and every other
 * role (student, parent) is left untouched so this can be layered onto routes those roles
 * also legitimately use without affecting them — `@Roles()` already governs who can reach
 * the route at all.
 */
@Injectable()
export class ModulePermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<ModulePermissionRequirement | undefined>(
      MODULE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;
    if (user.role !== 'teacher') return true;

    if (!hasModulePermission(user.modulePermissions, requirement.module, requirement.action)) {
      throw new ForbiddenException(
        `You don't have "${requirement.action}" permission for ${requirement.module}. Ask an admin to grant it.`,
      );
    }
    return true;
  }
}
