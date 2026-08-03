import { IsArray, IsOptional, IsString } from 'class-validator';

export class SubmitAssignmentDto {
  @IsString()
  @IsOptional()
  fileUrl?: string;

  @IsString()
  @IsOptional()
  textAnswer?: string;

  @IsArray()
  @IsOptional()
  quizAnswers?: any[];
}
