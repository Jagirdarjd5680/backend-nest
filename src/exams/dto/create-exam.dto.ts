import { IsArray, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

/** HTML forms send numbers as strings and unset selects as '' — coerce both before validating. */
const OptNumber = () => Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)));
const OptDate = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class CreateExamDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  duration?: number;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  totalMarks?: number;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  passingMarks?: number;

  @OptDate()
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @OptDate()
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @OptNumber()
  @IsNumber()
  @IsOptional()
  courseId?: number;

  @OptNumber()
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
