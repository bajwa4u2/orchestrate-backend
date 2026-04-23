import { Module, forwardRef } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RepliesModule } from '../replies/replies.module';
import { DeliverabilityModule } from '../deliverability/deliverability.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { EmailsController } from './emails.controller';
import { EmailsService } from './emails.service';

@Module({
  imports: [
    DatabaseModule,
    AccessContextModule,
    NotificationsModule,
    forwardRef(() => RepliesModule),
    DeliverabilityModule,
    WorkflowsModule,
  ],
  controllers: [EmailsController],
  providers: [EmailsService],
  exports: [EmailsService],
})
export class EmailsModule {}
