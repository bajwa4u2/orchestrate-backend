import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ReplyClassificationWorkerService } from './reply-classification.worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [ReplyClassificationWorkerService],
  exports: [ReplyClassificationWorkerService],
})
export class ReplyClassificationWorkerModule {}
