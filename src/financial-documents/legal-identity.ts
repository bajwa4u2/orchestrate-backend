export const ORCHESTRATE_LEGAL_IDENTITY = {
  brandName: 'Orchestrate',
  relationshipStatement: 'Orchestrate is a product of Aura Platform LLC.',
  legalEntityName: 'Aura Platform LLC',
  legalEntityAddressLines: ['40065 Eaton St Apt 101', 'Canton, MI 48187', 'United States'],
  legalEntityEin: '41-4721252',
  domain: 'orchestrateops.com',
  defaultSupportEmail: 'support@orchestrateops.com',
  defaultBillingEmail: 'billing@orchestrateops.com',
  defaultHelloEmail: 'hello@orchestrateops.com',
} as const;

export function getIssuerBlockLines() {
  return [
    ORCHESTRATE_LEGAL_IDENTITY.legalEntityName,
    ...ORCHESTRATE_LEGAL_IDENTITY.legalEntityAddressLines,
    `EIN: ${ORCHESTRATE_LEGAL_IDENTITY.legalEntityEin}`,
  ];
}
