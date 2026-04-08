import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { StatementDocumentBuilder } from './dto/statement-document.builder';
import { StatementHtmlRenderer } from './dto/statement-html.renderer';
import { StatementDeliveryService } from './statement-delivery.service';
import { StatementsController } from './statements.controller';
import { StatementsService } from './statements.service';

@Module({
  imports: [AccessContextModule, EmailsModule, WorkflowsModule],
  controllers: [StatementsController],
  providers: [StatementsService, StatementDocumentBuilder, StatementHtmlRenderer, StatementDeliveryService],
  exports: [StatementsService, StatementDeliveryService],
})
export class StatementsModule {}
