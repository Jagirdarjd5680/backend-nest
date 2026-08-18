import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsBoolean()
  @IsOptional()
  twoFactorEnabled?: boolean;

  @IsString()
  @IsOptional()
  permissions?: string;

  @IsOptional()
  modulePermissions?: Record<string, Record<string, boolean>>;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  authMethod?: string;

  @IsOptional()
  moduleAccess?: string[];

  // Course/batch assignment — whitelist: true on the global ValidationPipe silently drops
  // any field not declared here, which is why "assign courses" used to look like it saved
  // (toast success, no error) but the enrollment/batch rows were never actually written.
  @IsOptional()
  enrolledCourses?: unknown[];

  @IsOptional()
  batches?: unknown[];
}
