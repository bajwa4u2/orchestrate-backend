import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AiModule } from '../ai/ai.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { RepliesModule } from '../replies/replies.module';
import { ExecutionController } from './execution.controller';
import { WorkersModule } from '../workers/workers.module';
import { ExecutionService } from './execution.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    AccessContextModule,
    DatabaseModule,
    WorkflowsModule,
    AiModule,
    SubscriptionsModule,
    forwardRef(() => MeetingsModule),
    forwardRef(() => RepliesModule),
    forwardRef(() => DeliverabilityModule),
    forwardRef(() => WorkersModule),
  ],
  controllers: [ExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}
