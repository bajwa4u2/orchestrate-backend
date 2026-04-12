import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExecutionModule } from '../execution/execution.module';
import { RepliesController } from './replies.controller';
import { RepliesService } from './replies.service';

@Module({
  imports: [DatabaseModule, WorkflowsModule, forwardRef(() => ExecutionModule)],
  controllers: [RepliesController],
  providers: [RepliesService],
  exports: [RepliesService],
})
export class RepliesModule {}
