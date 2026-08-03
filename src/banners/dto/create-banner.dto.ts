import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsEnum } from 'class-validator';

export class CreateBannerDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  image?: string; // Accept 'image' for Express compatibility

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsString()
  @IsNotEmpty()
  @IsEnum(['blog', 'course', 'exam', 'external', 'none'])
  linkType: string;

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
