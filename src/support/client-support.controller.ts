import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import { IntakeService } from '../intake/intake.service';
import { NormalizedIntakeInput } from '../intake/intake.types';

@Controller('client/support')
export class ClientSupportController {
  constructor(private readonly intake: IntakeService) {}

  @Post('intake')
  async intakeRequest(
    @Req() req: any,
    @Body() body: { message: string; sourcePage?: string | null; inquiryTypeHint?: string | null },
  ) {
    const user = req.user;

    const input: NormalizedIntakeInput = {
      source: 'CLIENT',
      message: body.message,
      name: user?.name ?? null,
      email: user?.email ?? null,
      company: null,
      userId: user?.id ?? null,
      clientId: user?.clientId ?? null,
      sourcePage: body.sourcePage ?? null,
      planContext: user?.plan ?? null,
      tierContext: user?.tier ?? null,
      inquiryTypeHint: body.inquiryTypeHint ?? null,
    };

    return this.intake.handlePublic(input);
  }

  @Post('intake/:sessionId/reply')
  async replyToSession(
    @Param('sessionId') sessionId: string,
    @Body() body: { message: string },
  ) {
    return this.intake.replyPublic(sessionId, body.message);
  }
}