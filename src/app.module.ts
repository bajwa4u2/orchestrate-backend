import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessContextModule } from './access-context/access-context.module';
import { AdaptationModule } from './adaptation/adaptation.module';
import { AgreementsModule } from './agreements/agreements.module';
import { AiModule } from './ai/ai.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { ClientsModule } from './clients/clients.module';
import { ControlModule } from './control/control.module';
import { DatabaseModule } from './database/database.module';
import { DeliverabilityModule } from './deliverability/deliverability.module';
import { EmailsModule } from './emails/emails.module';
import { ExecutionModule } from './execution/execution.module';
import { HealthModule } from './health/health.module';
import { IntakeModule } from './intake/intake.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LeadsModule } from './leads/leads.module';
import { LeadSourcesModule } from './lead-sources/lead-sources.module';
import { MeetingsModule } from './meetings/meetings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OperatorModule } from './operator/operator.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProvidersModule } from './providers/providers.module';
import { PublicModule } from './public/public.module';
import { QualificationModule } from './qualification/qualification.module';
import { ReachabilityModule } from './reachability/reachability.module';
import { RemindersModule } from './reminders/reminders.module';
import { RepliesModule } from './replies/replies.module';
import { SignalsModule } from './signals/signals.module';
import { SourcesModule } from './sources/sources.module';
import { StatementsModule } from './statements/statements.module';
import { StrategyModule } from './strategy/strategy.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { TemplatesModule } from './templates/templates.module';
import { UsersModule } from './users/users.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    DatabaseModule,
    AccessContextModule,
    HealthModule,
    PublicModule,
    IntakeModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    ClientsModule,
    CampaignsModule,
    LeadsModule,
    LeadSourcesModule,
    ProvidersModule,
    StrategyModule,
    SignalsModule,
    SourcesModule,
    ReachabilityModule,
    QualificationModule,
    AdaptationModule,
    AnalyticsModule,
    DeliverabilityModule,
    EmailsModule,
    RepliesModule,
    MeetingsModule,
    NotificationsModule,
    ExecutionModule,
    ControlModule,
    BillingModule,
    SubscriptionsModule,
    AgreementsModule,
    StatementsModule,
    RemindersModule,
    TemplatesModule,
    OperatorModule,
    ClientPortalModule,
    InvoicesModule,
    AiModule,
    WorkersModule,
  ],
})
export class AppModule {}
