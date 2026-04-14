import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ScoringWorkerService } from './scoring.worker.service';

@Module({ imports: [DatabaseModule], providers: [ScoringWorkerService], exports: [ScoringWorkerService] })
export class ScoringWorkerModule {}
