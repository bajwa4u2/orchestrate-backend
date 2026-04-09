import { Module } from '@nestjs/common';
import { EmailsModule } from '../emails/emails.module';
import { IntakeModule } from '../intake/intake.module';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

@Module({
  imports: [EmailsModule, IntakeModule],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
