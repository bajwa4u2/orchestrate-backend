import { Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { AccessContextService } from '../access-context/access-context.service';
import { PrismaService } from '../database/prisma.service';
import { IntakeService } from '../intake/intake.service';
import { NormalizedIntakeInput } from '../intake/intake.types';

@Controller('client/support')
export class ClientSupportController {
  constructor(
    private readonly intake: IntakeService,
    private readonly accessContextService: AccessContextService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('intake')
  async intakeRequest(
    @Headers() headers: Record<string, unknown>,
    @Body() body: { message: string; sourcePage?: string | null; inquiryTypeHint?: string | null },
  ) {
    const context = await this.accessContextService.requireClient(headers);
    const user = await this.prisma.user.findUnique({
      where: { id: context.userId! },
      select: { id: true, fullName: true, email: true },
    });
    const client = await this.prisma.client.findUnique({
      where: { id: context.clientId! },
      select: { selectedPlan: true },
    });

    const input: NormalizedIntakeInput = {
      source: 'CLIENT',
      message: body.message,
      name: user?.fullName ?? null,
      email: user?.email ?? context.email ?? null,
      company: null,
      userId: context.userId!,
      clientId: context.clientId!,
      sourcePage: body.sourcePage ?? null,
      planContext: 
      client?.selectedPlan === 'opportunity' || client?.selectedPlan === 'revenue'
        ? client.selectedPlan
        : null,
      tierContext: null,
      inquiryTypeHint: body.inquiryTypeHint ?? null,
    };

    return this.intake.handlePublic(input);
  }

  @Post('intake/:sessionId/reply')
  async replyToSession(
    @Headers() headers: Record<string, unknown>,
    @Param('sessionId') sessionId: string,
    @Body() body: { message: string },
  ) {
    await this.accessContextService.requireClient(headers);
    return this.intake.replyPublic(sessionId, body.message);
  }
}
