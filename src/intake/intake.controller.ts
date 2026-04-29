import { Body, Controller, Param, Post } from '@nestjs/common';
import { CreatePublicIntakeDto } from './dto/create-public-intake.dto';
import { ReplyIntakeDto } from './dto/reply-intake.dto';
import { IntakeService } from './intake.service';

@Controller('public')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('intake')
  async publicIntake(@Body() body: CreatePublicIntakeDto) {
    return this.intake.handlePublic({
      source: 'PUBLIC',
      name: body.name,
      email: body.email,
      company: body.company ?? null,
      message: body.message,
      sourcePage: body.sourcePage ?? null,
      planContext: null,
      tierContext: null,
      inquiryTypeHint: body.inquiryTypeHint ?? null,
    });
  }

  @Post('intake/:sessionId/reply')
  async publicReply(
    @Param('sessionId') sessionId: string,
    @Body() body: ReplyIntakeDto,
  ) {
    return this.intake.replyPublic(sessionId, body.message, {
      publicSessionToken: body.sessionToken,
    });
  }
}
