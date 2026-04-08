import { LeadCandidate } from '../contracts/lead.contract';
import { StrategyBrief } from '../contracts/strategy.contract';

export function buildWriterPrompt(strategy: StrategyBrief, lead: LeadCandidate): string {
  return [
    'Write a concise cold outbound email for the lead below.',
    'Return JSON only.',
    'Keep the message natural, specific, and non-hype.',
    '',
    `Campaign Name: ${strategy.campaignName}`,
    `Objective: ${strategy.objective}`,
    `Offer Summary: ${strategy.offerSummary}`,
    `Pain Points: ${strategy.painPoints.join(', ')}`,
    `Value Angles: ${strategy.valueAngles.join(', ')}`,
    `Tone: ${strategy.tone}`,
    `Call To Action: ${strategy.callToAction}`,
    `Booking URL: ${strategy.bookingUrlOverride ?? 'N/A'}`,
    '',
    `Lead Name: ${lead.contactFullName}`,
    `Lead Title: ${lead.title}`,
    `Company: ${lead.companyName}`,
    `Region: ${lead.region ?? lead.countryCode ?? 'N/A'}`,
    `Reason For Fit: ${lead.reasonForFit}`,
    '',
    'Required JSON keys:',
    'subject, body, tone, intent',
  ].join('\n');
}
