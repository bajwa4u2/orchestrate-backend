const DEFAULT_PROTECTED_DOMAINS = [
  'orchestrateops.com',
  'www.orchestrateops.com',
  'auraplatform.org',
  'www.auraplatform.org',
];

const DEFAULT_PROTECTED_TOKENS = [
  'orchestrate',
  'orchestrateops',
  'aura',
  'auraplatform',
  'directorycandidate',
  'directory-candidate',
];

function readCsv(value?: string | null) {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function domainFromAddress(value?: string | null) {
  const email = (value || '').trim().toLowerCase();
  if (!email.includes('@')) return null;
  return email.split('@')[1] || null;
}

function normalizeDomain(value?: string | null) {
  const text = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .split('?')[0]
    .trim();
  return text || null;
}

export class SelfExclusionService {
  private readonly protectedDomains: string[];
  private readonly protectedTokens: string[];

  constructor() {
    const envDomains = [
      ...readCsv(process.env.PROTECTED_OUTREACH_DOMAINS),
      normalizeDomain(process.env.APP_DOMAIN),
      normalizeDomain(process.env.WEB_DOMAIN),
      normalizeDomain(process.env.API_DOMAIN),
      domainFromAddress(process.env.EMAIL_REPLY_TO_HELLO),
      domainFromAddress(process.env.EMAIL_REPLY_TO_SUPPORT),
      domainFromAddress(process.env.EMAIL_REPLY_TO_BILLING),
      domainFromAddress(process.env.EMAIL_FROM_HELLO),
      domainFromAddress(process.env.EMAIL_FROM_SUPPORT),
      domainFromAddress(process.env.EMAIL_FROM_BILLING),
    ].filter(Boolean) as string[];

    this.protectedDomains = Array.from(new Set([...DEFAULT_PROTECTED_DOMAINS, ...envDomains]));
    this.protectedTokens = Array.from(
      new Set([...DEFAULT_PROTECTED_TOKENS, ...readCsv(process.env.PROTECTED_OUTREACH_TOKENS)]),
    );
  }

  listProtectedDomains() {
    return [...this.protectedDomains];
  }

  listProtectedTokens() {
    return [...this.protectedTokens];
  }

  isProtectedDomain(domain?: string | null) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return false;
    if (this.protectedDomains.includes(normalized)) return true;
    return this.protectedTokens.some((token) => normalized.includes(token));
  }

  isProtectedName(name?: string | null) {
    const text = (name || '').trim().toLowerCase();
    if (!text) return false;
    return this.protectedTokens.some((token) => text.includes(token));
  }

  isProtectedEmail(email?: string | null) {
    const domain = domainFromAddress(email);
    return this.isProtectedDomain(domain);
  }
}

export const selfExclusionService = new SelfExclusionService();
