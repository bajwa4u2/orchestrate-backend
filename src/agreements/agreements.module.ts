import { Module } from '@nestjs/common';
import { AccessContextModule } from '../access-context/access-context.module';
import { EmailsModule } from '../emails/emails.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AgreementDeliveryService } from './agreement-delivery.service';
import { AgreementsController } from './agreements.controller';
import { AgreementsService } from './agreements.service';
import { AgreementDocumentBuilder } from './dto/agreement-document.builder';
import { AgreementHtmlRenderer } from './dto/agreement-html.renderer';

@Module({
  imports: [AccessContextModule, EmailsModule, WorkflowsModule],
  controllers: [AgreementsController],
  providers: [AgreementsService, AgreementDocumentBuilder, AgreementHtmlRenderer, AgreementDeliveryService],
  exports: [AgreementsService, AgreementDeliveryService],
})
export class AgreementsModule {}
