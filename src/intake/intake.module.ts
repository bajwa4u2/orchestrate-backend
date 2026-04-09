import { Module } from '@nestjs/common';
import { IntakeController } from './intake.controller';
import { IntakeService } from './intake.service';
import { IntakeAiService } from '../ai/intake-ai.service';

@Module({
  controllers: [IntakeController],
  providers: [IntakeService, IntakeAiService],
  exports: [IntakeService],
})
export class IntakeModule {}
