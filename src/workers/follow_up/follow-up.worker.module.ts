import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { FirstSendWorkerModule } from '../first_send/first-send.worker.module';
import { FollowUpWorkerService } from './follow-up.worker.service';

@Module({
  imports: [DatabaseModule, FirstSendWorkerModule],
  providers: [FollowUpWorkerService],
  exports: [FollowUpWorkerService],
})
export class FollowUpWorkerModule {}
