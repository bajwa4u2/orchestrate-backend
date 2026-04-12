import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AiModule } from '../ai/ai.module';
import { MeetingsModule } from '../meetings/meetings.module';
import { RepliesModule } from '../replies/replies.module';
import { ExecutionController } from './execution.controller';
import { ExecutionService } from './execution.service';

@Module({
  imports: [
    DatabaseModule,
    WorkflowsModule,
    AiModule,
    forwardRef(() => MeetingsModule),
    forwardRef(() => RepliesModule),
    forwardRef(() => DeliverabilityModule),
  ],
  controllers: [ExecutionController],
  providers: [ExecutionService],
  exports: [ExecutionService],
})
export class ExecutionModule {}