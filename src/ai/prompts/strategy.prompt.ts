import { ServiceProfileInput } from '../contracts/service-profile.contract';

export function buildStrategyPrompt(input: ServiceProfileInput): string {
  return [
    'Build a concise outbound campaign strategy for the following client profile.',
    'Return JSON only.',
    '',
    `Business Name: ${input.businessName}`,
    `Website: ${input.websiteUrl ?? 'N/A'}`,
    `Industry: ${input.industry}`,
    `Offer Name: ${input.offerName}`,
    `Offer Summary: ${input.offerSummary}`,
    `Desired Outcome: ${input.desiredOutcome}`,
    `Countries: ${input.countries.join(', ')}`,
    `Regions: ${input.regions.join(', ')}`,
    `Excluded Regions: ${(input.excludedRegions ?? []).join(', ') || 'None'}`,
    `Buyer Roles: ${input.buyerRoles.join(', ')}`,
    `Buyer Industries: ${(input.buyerIndustries ?? []).join(', ') || input.industry}`,
    `Tone: ${input.tone ?? 'professional, direct, calm'}`,
    `Call To Action: ${input.callToAction ?? 'book a short intro call'}`,
    `Booking URL: ${input.bookingUrl ?? 'N/A'}`,
    `Compliance Notes: ${(input.complianceNotes ?? []).join('; ') || 'None provided'}`,
    '',
    'Required JSON keys:',
    'icpName, campaignName, objective, offerSummary, industryTags, geoTargets, titleKeywords, exclusionKeywords, painPoints, valueAngles, tone, callToAction, bookingUrlOverride, segmentNotes',
  ].join('\n');
}
