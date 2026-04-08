import { StrategyBrief } from '../contracts/strategy.contract';

export function buildSequencePrompt(strategy: StrategyBrief, stepCount: number): string {
  return [
    'Create a practical outbound follow-up sequence.',
    'Return JSON only in the form {"steps": [...]}',
    'Do not overdo the copy. Keep it simple, credible, and useful.',
    '',
    `Campaign Name: ${strategy.campaignName}`,
    `Objective: ${strategy.objective}`,
    `Offer Summary: ${strategy.offerSummary}`,
    `Tone: ${strategy.tone}`,
    `Call To Action: ${strategy.callToAction}`,
    '',
    `Step Count: ${stepCount}`,
    '',
    'Each step must contain:',
    'orderIndex, waitDays, subjectTemplate, bodyTemplate, instructionText',
  ].join('\n');
}
