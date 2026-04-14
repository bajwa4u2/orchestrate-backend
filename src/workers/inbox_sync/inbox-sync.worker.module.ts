import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InboxSyncWorkerService } from './inbox-sync.worker.service';

@Module({ imports: [DatabaseModule], providers: [InboxSyncWorkerService], exports: [InboxSyncWorkerService] })
export class InboxSyncWorkerModule {}
