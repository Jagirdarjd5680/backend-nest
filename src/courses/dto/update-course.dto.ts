import { IsArray, IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateCourseDto {
  @IsString()
  @IsOptional()
  title?: string;

  // Frontend's CourseWizard sends the category select's value under this key (not
  // `categoryId`) — must stay declared here or the global ValidationPipe's
  // `whitelist: true` silently drops it before it reaches CoursesService.
  @IsOptional()
  category?: string | number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsNumber()
  @IsOptional()
  originalPrice?: number;

  @IsString()
  @IsOptional()
  level?: string;

  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;

  @IsNumber()
  @IsOptional()
  durationValue?: number;

  @IsString()
  @IsOptional()
  durationUnit?: string;

  @IsNumber()
  @IsOptional()
  readingDurationValue?: number;

  @IsString()
  @IsOptional()
  readingDurationUnit?: string;

  @IsString()
  @IsOptional()
  demoVideoUrl?: string;

  @IsBoolean()
  @IsOptional()
  isCertificate?: boolean;

  @IsString()
  @IsOptional()
  certificateName?: string;

  @IsString()
  @IsOptional()
  gstType?: string;

  @IsNumber()
  @IsOptional()
  gstPercent?: number;

  @IsNumber()
  @IsOptional()
  fakeLikes?: number;

  @IsString()
  @IsOptional()
  courseType?: string;

  @IsBoolean()
  @IsOptional()
  allowOtherBatchMaterials?: boolean;

  // "web" | "app" | "both" — which platform(s) may access this course.
  @IsString()
  @IsOptional()
  platformAccess?: string;

  @IsArray()
  @IsOptional()
  modules?: any[];

  @IsNumber()
  @IsOptional()
  categoryId?: number;

  @IsNumber()
  @IsOptional()
  instructorId?: number;
}
