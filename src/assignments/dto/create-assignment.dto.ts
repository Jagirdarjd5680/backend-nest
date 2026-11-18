import { IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

const OptNumber = () => Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)));

/** Shared unlock-rule fields (see common/course-unlock.ts). */
export class UnlockRuleDto {
  @IsString()
  @IsIn(['immediate', 'after_days', 'after_modules', 'after_module'])
  @IsOptional()
  unlockMode?: string;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  unlockAfterDays?: number;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  unlockAfterModules?: number;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  unlockModuleIndex?: number;

  /** fixed | days_after_open | course_end - see Assignment.deadlineMode in the Prisma schema. */
  @IsString()
  @IsIn(['fixed', 'days_after_open', 'course_end'])
  @IsOptional()
  deadlineMode?: string;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  deadlineDays?: number;
}

/** Settings the admin form edits besides title/description (without these the whitelist dropped them on save). */
export class AssignmentSettingsDto extends UnlockRuleDto {
  @OptNumber()
  @IsNumber()
  @IsOptional()
  totalMarks?: number;

  @IsString()
  @IsOptional()
  assignmentType?: string;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  maxMb?: number;

  @IsString()
  @IsOptional()
  allowedFormats?: string;

  @IsArray()
  @IsOptional()
  attachments?: any[];

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}

export class CreateAssignmentDto extends AssignmentSettingsDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  filePath?: string;

  // Only a standalone (no course) assignment needs a calendar date; course assignments are
  // due relative to when they open for each student (deadlineMode / deadlineDays).
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  // Optional on create so a course assignment can be linked right away.
  @IsOptional()
  courseId?: number | null;
}

export class UpdateAssignmentDto extends AssignmentSettingsDto {
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
