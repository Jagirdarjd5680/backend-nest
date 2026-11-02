import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class IssueCertificateDto {
  // The admin UI holds ids as strings ("40") — accept them as numbers.
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  studentId: number;

  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  courseId: number;

  @IsBoolean()
  @IsOptional()
  force?: boolean;

  // From the admin's certificate Edit form — empty means "use the live value".
  @IsOptional() @IsString() @MaxLength(120) studentName?: string;
  @IsOptional() @IsString() @MaxLength(160) courseName?: string;
  @IsOptional() @IsString() @MaxLength(60) duration?: string;
  @IsOptional() @IsString() @MaxLength(20) grade?: string;
  @IsOptional() @IsString() @MaxLength(160) specialization?: string;
}

/** Just the printed fields (the Edit form's preview). */
export class CertificateFieldsDto {
  @IsOptional() @IsString() @MaxLength(120) studentName?: string;
  @IsOptional() @IsString() @MaxLength(160) courseName?: string;
  @IsOptional() @IsString() @MaxLength(60) duration?: string;
  @IsOptional() @IsString() @MaxLength(20) grade?: string;
  @IsOptional() @IsString() @MaxLength(160) specialization?: string;
}
