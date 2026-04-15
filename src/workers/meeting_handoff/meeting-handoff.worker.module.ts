import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EmailsModule } from '../../emails/emails.module';
import { MeetingHandoffWorkerService } from './meeting-handoff.worker.service';

@Module({
  imports: [DatabaseModule, EmailsModule],
  providers: [MeetingHandoffWorkerService],
  exports: [MeetingHandoffWorkerService],
})
export class MeetingHandoffWorkerModule {}
