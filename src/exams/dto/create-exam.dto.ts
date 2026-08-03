import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateExamDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  duration?: number;

  @IsNumber()
  @IsOptional()
  totalMarks?: number;

  @IsNumber()
  @IsOptional()
  passingMarks?: number;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  @IsOptional()
  courseId?: number;

  @IsNumber()
  @IsOptional()
  moduleId?: number;
}

export class SubmitExamDto {
  @IsNumber()
  @IsNotEmpty()
  examId: number;

  @IsArray()
  @IsNotEmpty()
  answers: { questionId: number; answer: string }[];
}

export class SubmitExamResultDto {
  @IsNumber()
  @IsNotEmpty()
  score: number;

  @IsNumber()
  @IsNotEmpty()
  studentId: number;

  @IsNumber()
  @IsNotEmpty()
  examId: number;
}

export class CreateQuestionDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsNotEmpty()
  options: string;

  @IsString()
  @IsNotEmpty()
  correctOption: string;

  @IsNumber()
  @IsOptional()
  marks?: number;

  @IsString()
  @IsOptional()
  explanation?: string;

  @IsNumber()
  @IsOptional()
  examId?: number;

  @IsNumber()
  @IsOptional()
  courseId?: number;
}
