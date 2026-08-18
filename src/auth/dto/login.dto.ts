import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  // Deliberately not @IsEmail() — this field also accepts a phone number (see
  // AuthService.validateUser, which branches on whether it looks like an email). The field is
  // still named `email` rather than something like `identifier` to avoid a breaking change for
  // every existing web/native caller that already POSTs { email, password }.
  @IsString()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
