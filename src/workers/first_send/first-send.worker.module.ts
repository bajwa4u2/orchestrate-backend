import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DeliverabilityModule } from '../../deliverability/deliverability.module';
import { EmailsModule } from '../../emails/emails.module';
import { MessageGenerationWorkerModule } from '../message_generation/message-generation.worker.module';
import { FirstSendWorkerService } from './first-send.worker.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => DeliverabilityModule), forwardRef(() => EmailsModule), MessageGenerationWorkerModule],
  providers: [FirstSendWorkerService],
  exports: [FirstSendWorkerService],
})
export class FirstSendWorkerModule {}
