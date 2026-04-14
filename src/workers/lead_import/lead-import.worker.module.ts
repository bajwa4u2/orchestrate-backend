import { Module } from '@nestjs/common';
import { AiModule } from '../../ai/ai.module';
import { DatabaseModule } from '../../database/database.module';
import { LeadImportWorkerService } from './lead-import.worker.service';

@Module({
  imports: [DatabaseModule, AiModule],
  providers: [LeadImportWorkerService],
  exports: [LeadImportWorkerService],
})
export class LeadImportWorkerModule {}
