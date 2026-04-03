import { Controller, Get, Headers } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('context')
  context(@Headers() headers: Record<string, unknown>) {
    return this.authService.resolveRequest(headers);
  }
}
