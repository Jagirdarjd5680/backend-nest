import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

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

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  authMethod?: string;

  @IsString()
  @IsOptional()
  permissions?: string;

  @IsOptional()
  moduleAccess?: string[];

  @IsOptional()
  modulePermissions?: Record<string, Record<string, boolean>>;

  @IsBoolean()
  @IsOptional()
  autoGeneratePassword?: boolean;

  // Course/batch assignment — whitelist: true on the global ValidationPipe silently drops
  // any field not declared here, which is why "assign courses" used to look like it saved
  // (toast success, no error) but the enrollment/batch rows were never actually written.
  @IsOptional()
  enrolledCourses?: unknown[];

  @IsOptional()
  batches?: unknown[];
}
