import { Controller, Get } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('v1/public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('overview')
  async getOverview() {
    return this.publicService.getOverview();
  }
}
