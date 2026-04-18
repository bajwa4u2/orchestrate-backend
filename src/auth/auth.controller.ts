import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ClientRegisterDto } from './dto/client-register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { OperatorBootstrapDto } from './dto/operator-bootstrap.dto';
import { RequestEmailVerificationDto } from './dto/request-email-verification.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('context')
  context(@Headers() headers: Record<string, unknown>) {
    return this.authService.resolveRequest(headers);
  }

  @Get('me')
  me(@Headers() headers: Record<string, unknown>) {
    return this.authService.me(headers);
  }

  @Post('client/register')
  registerClient(@Body() dto: ClientRegisterDto) {
    return this.authService.registerClient(dto);
  }

  @Post('client/login')
  loginClient(@Body() dto: LoginDto) {
    return this.authService.loginClient(dto);
  }

  @Post('client/oauth/google')
  loginClientWithGoogle(@Body() dto: OAuthLoginDto) {
    return this.authService.loginClientWithGoogle(dto);
  }

  @Post('client/oauth/microsoft')
  loginClientWithMicrosoft(@Body() dto: OAuthLoginDto) {
    return this.authService.loginClientWithMicrosoft(dto);
  }

  @Post('client/oauth/apple')
  loginClientWithApple(@Body() dto: OAuthLoginDto) {
    return this.authService.loginClientWithApple(dto);
  }

  @Post('operator/bootstrap')
  bootstrapOperator(@Body() dto: OperatorBootstrapDto) {
    return this.authService.bootstrapOperator(dto);
  }

  @Post('operator/login')
  loginOperator(@Body() dto: LoginDto) {
    return this.authService.loginOperator(dto);
  }

  @Post('logout')
  logout() {
    return this.authService.logout();
  }

  @Post('password/request-reset')
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('email/request-verification')
  requestEmailVerification(@Body() dto: RequestEmailVerificationDto) {
    return this.authService.requestEmailVerification(dto);
  }

  @Post('email/verify')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }
}
