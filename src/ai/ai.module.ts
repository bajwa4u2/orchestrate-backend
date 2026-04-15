import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessContextModule } from '../access-context/access-context.module';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { LeadAgent } from './agents/lead.agent';
import { SequenceAgent } from './agents/sequence.agent';
import { StrategyAgent } from './agents/strategy.agent';
import { WriterAgent } from './agents/writer.agent';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  imports: [ConfigModule, WorkflowsModule, AccessContextModule],
  controllers: [AiController],
  providers: [
    PrismaService,
    AiService,
    OpenAiProvider,
    StrategyAgent,
    LeadAgent,
    WriterAgent,
    SequenceAgent,
  ],
  exports: [AiService],
})
export class AiModule {}
