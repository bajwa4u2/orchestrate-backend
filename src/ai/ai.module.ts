import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LeadAgent } from './agents/lead.agent';
import { SequenceAgent } from './agents/sequence.agent';
import { StrategyAgent } from './agents/strategy.agent';
import { WriterAgent } from './agents/writer.agent';
import { AiService } from './ai.service';
import { OpenAiProvider } from './providers/openai.provider';

@Module({
  imports: [DatabaseModule],
  providers: [OpenAiProvider, StrategyAgent, LeadAgent, WriterAgent, SequenceAgent, AiService],
  exports: [AiService],
})
export class AiModule {}
