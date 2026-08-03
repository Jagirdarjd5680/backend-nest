import { IsString, IsOptional, IsNumber, IsBoolean, IsEnum } from 'class-validator';

export class UpdateBannerDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsOptional()
  @IsEnum(['blog', 'course', 'exam', 'external', 'none'])
  linkType?: string;

  @IsNumber()
  @IsOptional()
  linkId?: number;

  @IsString()
  @IsOptional()
  externalUrl?: string;

  @IsNumber()
  @IsOptional()
  order?: number;

  @IsString()
  @IsOptional()
  @IsEnum(['published', 'draft'])
  status?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
