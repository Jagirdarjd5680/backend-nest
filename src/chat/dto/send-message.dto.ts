import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class SendMessageDto {
  @Type(() => Number)
  @IsInt()
  receiver: number;

  @IsString()
  @IsOptional()
  message?: string;

  @IsString()
  @IsOptional()
  image?: string;

  @IsString()
  @IsOptional()
  sessionId?: string;
}
