import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateLiveClassDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  meetingLink?: string;

  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @IsNumber()
  @IsOptional()
  durationMins?: number;

  @IsString()
  @IsOptional()
  status?: string;
}
