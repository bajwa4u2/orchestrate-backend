import { Body, Controller, Post } from '@nestjs/common';
import { IntakeService } from './intake.service';

@Controller('public')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('intake')
  async publicIntake(@Body() body: any) {
    return this.intake.handlePublic({
      source: 'PUBLIC',
      name: body.name,
      email: body.email,
      company: body.company ?? null,
      message: body.message,
      sourcePage: body?.context?.page ?? null,
      planContext: body?.context?.plan ?? null,
      tierContext: body?.context?.tier ?? null,
      inquiryTypeHint: body?.inquiryType ?? null,
    });
  }
}
