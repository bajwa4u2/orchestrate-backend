import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreatePublicIntakeDto } from '../intake/dto/create-public-intake.dto';
import { ReplyIntakeDto } from '../intake/dto/reply-intake.dto';
import { CreatePublicContactDto } from './dto/create-public-contact.dto';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('overview')
  async getOverview() {
    return this.publicService.getOverview();
  }

  @Get('pricing')
  async getPricing() {
    return this.publicService.getPricing();
  }

  @Post('contact')
  async submitContact(@Body() dto: CreatePublicContactDto) {
    return this.publicService.submitContact(dto);
  }

  @Post('intake')
  async submitIntake(@Body() body: CreatePublicIntakeDto) {
    return this.publicService.submitIntake(body);
  }

  @Post('intake/:sessionId/reply')
  async replyToSession(
    @Param('sessionId') sessionId: string,
    @Body() body: ReplyIntakeDto,
  ) {
    return this.publicService.replyToIntakeSession(sessionId, body.message, body.sessionToken);
  }
}
