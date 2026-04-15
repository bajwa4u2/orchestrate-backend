import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { AiModule } from '../ai/ai.module';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { RepliesModule } from '../replies/replies.module';
import { WorkersModule } from '../workers/workers.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';

@Module({
  imports: [
    DatabaseModule,
    WorkflowsModule,
    AiModule,
    AccessContextModule,
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
