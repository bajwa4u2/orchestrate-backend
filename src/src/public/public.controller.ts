import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreatePublicContactDto } from './dto/create-public-contact.dto';
import { PublicService } from './public.service';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('overview')
  async getOverview() {
    return this.publicService.getOverview();
  }

  @Post('contact')
  async submitContact(@Body() dto: CreatePublicContactDto) {
    return this.publicService.submitContact(dto);
  }
}
