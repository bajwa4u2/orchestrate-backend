import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EmailsModule } from '../../emails/emails.module';
import { MeetingHandoffWorkerService } from './meeting-handoff.worker.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => EmailsModule)],
  providers: [MeetingHandoffWorkerService],
  exports: [MeetingHandoffWorkerService],
})
export class MeetingHandoffWorkerModule {}
