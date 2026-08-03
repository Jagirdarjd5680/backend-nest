import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  @IsNotEmpty()
  courseId: number;

  @IsString()
  @IsOptional()
  couponCode?: string;
}
