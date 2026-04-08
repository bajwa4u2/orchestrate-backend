import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [DatabaseModule],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
