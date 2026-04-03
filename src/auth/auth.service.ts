import { Injectable } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';

@Injectable()
export class AuthService {
  constructor(private readonly accessContextService: AccessContextService) {}

  resolveRequest(headers: Record<string, unknown>) {
    return this.accessContextService.buildFromHeaders(headers);
  }
}
