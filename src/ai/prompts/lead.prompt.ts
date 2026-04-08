import { LeadCandidate } from '../contracts/lead.contract';
import { StrategyBrief } from '../contracts/strategy.contract';

export function buildLeadPrompt(strategy: StrategyBrief, leadCount: number): string {
  return [
    'Generate realistic outbound lead candidates for the strategy below.',
    'Return JSON only in the form {"leads": [...]}',
    'Do not invent impossible company scales or obviously fake names.',
    '',
    `Campaign Name: ${strategy.campaignName}`,
    `Objective: ${strategy.objective}`,
    `Industry Tags: ${strategy.industryTags.join(', ')}`,
    `Geo Targets: ${strategy.geoTargets.join(', ')}`,
    `Title Keywords: ${strategy.titleKeywords.join(', ')}`,
    `Pain Points: ${strategy.painPoints.join(', ')}`,
    `Value Angles: ${strategy.valueAngles.join(', ')}`,
    `Tone: ${strategy.tone}`,
    `Call To Action: ${strategy.callToAction}`,
    '',
    `Lead Count: ${leadCount}`,
    '',
    'Each lead must contain:',
    'companyName, domain, industry, employeeCount, contactFullName, firstName, lastName, title, email, linkedinUrl, city, region, countryCode, timezone, reasonForFit, qualificationNotes, priority',
  ].join('\n');
}

export function normalizeLeadCandidates(raw: { leads?: LeadCandidate[] } | null | undefined): LeadCandidate[] {
  return Array.isArray(raw?.leads) ? raw!.leads : [];
}
