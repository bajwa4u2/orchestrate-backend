import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InvoiceGenerationWorkerService } from './invoice-generation.worker.service';

@Module({ imports: [DatabaseModule], providers: [InvoiceGenerationWorkerService], exports: [InvoiceGenerationWorkerService] })
export class InvoiceGenerationWorkerModule {}
