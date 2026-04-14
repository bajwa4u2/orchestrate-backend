import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AlertGenerationWorkerService } from './alert-generation.worker.service';

@Module({ imports: [DatabaseModule], providers: [AlertGenerationWorkerService], exports: [AlertGenerationWorkerService] })
export class AlertGenerationWorkerModule {}
