import { Injectable } from '@nestjs/common';
import { LeadCandidate } from '../contracts/lead.contract';
import { StrategyBrief } from '../contracts/strategy.contract';
import { AiEngineService } from '../core/ai-engine.service';
import { normalizeLeadCandidates, buildLeadPrompt } from '../prompts/lead.prompt';

@Injectable()
export class LeadAgent {
  constructor(private readonly aiEngine: AiEngineService) {}

  async generate(strategy: StrategyBrief, leadCount: number): Promise<LeadCandidate[]> {
    const result = await this.aiEngine.structured<{ leads: LeadCandidate[] }>({
      purpose: 'generation.leads',
      modelTier: 'fast',
      systemPrompt:
        'You generate realistic B2B lead candidates. Return valid JSON only. Do not add commentary.',
      userPrompt: buildLeadPrompt(strategy, leadCount),
      schema: this.schema(),
      retries: 2,
      metadata: { agent: 'lead', leadCount },
    });

    return normalizeLeadCandidates(result.output);
  }

  private schema() {
    return {
      name: 'orchestrate_lead_candidates',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          leads: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                companyName: { type: 'string' },
                domain: { type: 'string' },
                industry: { type: 'string' },
                employeeCount: { type: 'number' },
                contactFullName: { type: 'string' },
                firstName: { type: 'string' },
                lastName: { type: 'string' },
                title: { type: 'string' },
                email: { type: 'string' },
                linkedinUrl: { type: 'string' },
                city: { type: 'string' },
                region: { type: 'string' },
                countryCode: { type: 'string' },
                timezone: { type: 'string' },
                reasonForFit: { type: 'string' },
                qualificationNotes: { type: 'string' },
                priority: { type: 'number' },
              },
              required: ['companyName', 'contactFullName', 'title', 'reasonForFit'],
            },
          },
        },
        required: ['leads'],
      },
    };
  }
}
