import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { DatabaseModule } from '../../database/database.module';
import { MessageGenerationWorkerService } from './message-generation.worker.service';

@Module({
  imports: [DatabaseModule, AiModule],
  providers: [MessageGenerationWorkerService],
  exports: [MessageGenerationWorkerService],
})
export class MessageGenerationWorkerModule {}
