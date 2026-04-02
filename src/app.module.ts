import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ClientsModule } from './clients/clients.module';
import { ControlModule } from './control/control.module';
import { DatabaseModule } from './database/database.module';
import { DeliverabilityModule } from './deliverability/deliverability.module';
import { ExecutionModule } from './execution/execution.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';
import { MeetingsModule } from './meetings/meetings.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RepliesModule } from './replies/replies.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    DatabaseModule,
    HealthModule,
    OrganizationsModule,
    UsersModule,
    ClientsModule,
    CampaignsModule,
    LeadsModule,
    DeliverabilityModule,
    RepliesModule,
    MeetingsModule,
    ExecutionModule,
    ControlModule,
  ],
})
export class AppModule {}
