import { Module } from '@nestjs/common';
import { IntakeService } from './intake.service';
import { IntakeAiService } from '../ai/intake-ai.service';
import { SupportCaseRepository } from '../support/support-case.repository';
import { SupportCaseService } from '../support/support-case.service';

@Module({
  controllers: [],
  providers: [
    IntakeService,
    IntakeAiService,
    SupportCaseRepository,
    SupportCaseService,
  ],
  exports: [IntakeService, SupportCaseService],
})
export class IntakeModule {}
