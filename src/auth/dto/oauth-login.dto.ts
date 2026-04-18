import {
  IsOptional,
  IsString,
  IsNotEmpty,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'oauthLoginTokenPresent', async: false })
class OAuthLoginTokenPresentConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const dto = args.object as OAuthLoginDto;
    const accessToken = typeof dto.accessToken === 'string' ? dto.accessToken.trim() : '';
    const idToken = typeof dto.idToken === 'string' ? dto.idToken.trim() : '';
    return accessToken.length > 0 || idToken.length > 0;
  }

  defaultMessage() {
    return 'Either accessToken or idToken is required';
  }
}

export class OAuthLoginDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  idToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @Validate(OAuthLoginTokenPresentConstraint)
  private readonly _tokenPresenceCheck!: true;
}
