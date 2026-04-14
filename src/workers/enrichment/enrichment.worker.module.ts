import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EnrichmentWorkerService } from './enrichment.worker.service';

@Module({ imports: [DatabaseModule], providers: [EnrichmentWorkerService], exports: [EnrichmentWorkerService] })
export class EnrichmentWorkerModule {}
