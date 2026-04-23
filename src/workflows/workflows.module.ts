import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [DatabaseModule, AccessContextModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
