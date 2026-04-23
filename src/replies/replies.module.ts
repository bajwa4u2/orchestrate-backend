import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { ExecutionModule } from '../execution/execution.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { RepliesController } from './replies.controller';
import { RepliesService } from './replies.service';

@Module({
  imports: [
    DatabaseModule,
    WorkflowsModule,
    AccessContextModule,
    DeliverabilityModule,
    forwardRef(() => ExecutionModule),
  ],
  controllers: [RepliesController],
  providers: [RepliesService],
  exports: [RepliesService],
})
export class RepliesModule {}
