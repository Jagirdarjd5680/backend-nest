import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadChunkDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @Type(() => Number)
  @IsNumber()
  chunkIndex: number;

  @Type(() => Number)
  @IsNumber()
  totalChunks: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  chunkSize?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  fileSize?: number;

  @IsString()
  @IsNotEmpty()
  uploadId: string;

  @IsString()
  @IsOptional()
  courseId?: string;

  @IsString()
  @IsOptional()
  title?: string;
}
