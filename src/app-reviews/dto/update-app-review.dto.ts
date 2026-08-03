import { IsString, IsNumber, Min, Max, IsOptional, IsEnum } from 'class-validator';

export class UpdateAppReviewDto {
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  rating?: number;

  @IsString()
  @IsOptional()
  review?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  profileImage?: string;

  @IsString()
  @IsOptional()
  @IsEnum(['active', 'inactive'])
  status?: string;

  @IsString()
  @IsOptional()
  videoUrl?: string;

  @IsString()
  @IsOptional()
  thumbnail?: string;

  @IsString()
  @IsOptional()
  @IsEnum(['16:9', '9:16'])
  aspectRatio?: string;

  @IsNumber()
  @IsOptional()
  userId?: number;
}
