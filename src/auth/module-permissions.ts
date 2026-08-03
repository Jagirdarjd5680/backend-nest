export const PERMISSION_MODULES = ['exams', 'courses', 'students', 'chat'] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_ACTIONS = ['view', 'add', 'edit', 'delete'] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type ModulePermissions = Partial<Record<PermissionModule, Partial<Record<PermissionAction, boolean>>>>;

export function hasModulePermission(
  modulePermissions: ModulePermissions | null | undefined,
  module: PermissionModule,
  action: PermissionAction,
): boolean {
  return modulePermissions?.[module]?.[action] === true;
}
