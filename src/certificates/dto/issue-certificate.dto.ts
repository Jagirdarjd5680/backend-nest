import { IsBoolean, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class IssueCertificateDto {
  @IsNumber()
  @IsNotEmpty()
  studentId: number;

  @IsNumber()
  @IsNotEmpty()
  courseId: number;

  @IsBoolean()
  @IsOptional()
  force?: boolean;
}
