import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MessageGenerationWorkerService } from './message-generation.worker.service';

@Module({
  imports: [DatabaseModule],
  providers: [MessageGenerationWorkerService],
  exports: [MessageGenerationWorkerService],
})
export class MessageGenerationWorkerModule {}
