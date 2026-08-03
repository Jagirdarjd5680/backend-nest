import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  filePath?: string;

  @IsDateString()
  @IsNotEmpty()
  dueDate: string;
}

export class UpdateAssignmentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  filePath?: string;

  @IsDateString()
  @IsOptional()
  dueDate?: string;

  // No @IsNumber() — must also accept an explicit `null` (unlinking from a course), which
  // a strict number validator would reject; the service parses/nulls it itself.
  @IsOptional()
  courseId?: number | null;
}
