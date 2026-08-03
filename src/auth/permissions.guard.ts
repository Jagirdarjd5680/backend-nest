import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    // Admin with 'fullControl' passes all permission checks
    if (user.role === 'admin' || user.permissions === 'fullControl') return true;

    // Check if user's permissions string contains any of the required permissions
    const userPermissions: string[] = user.permissions ? user.permissions.split(',').map((p: string) => p.trim()) : [];

    return requiredPermissions.some((perm) => userPermissions.includes(perm));
  }
}
