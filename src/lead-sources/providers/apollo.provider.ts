import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExternalLeadCandidate,
  ExternalLeadSearchResult,
  LeadSourceProviderContract,
  LeadSourceSearchInput,
} from '../lead-sources.types';

interface ApolloApiSearchPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email_status?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization_id?: string;
  organization?: {
    id?: string;
    name?: string;
    primary_domain?: string;
    website_url?: string;
    estimated_num_employees?: number;
    industry?: string;
  };
}

interface ApolloApiSearchResponse {
  people?: ApolloApiSearchPerson[];
}

interface ApolloBulkMatchResponseItem {
  person?: {
    id?: string;
    first_name?: string;
    last_name?: string;
    name?: string;
    title?: string;
    email?: string | null;
    email_status?: string | null;
    linkedin_url?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    organization?: {
      id?: string;
      name?: string;
      primary_domain?: string;
      website_url?: string;
      estimated_num_employees?: number;
      industry?: string;
    };
  };
}

interface ApolloBulkMatchResponse {
  matches?: ApolloBulkMatchResponseItem[];
  people?: ApolloBulkMatchResponseItem[];
}

@Injectable()
export class ApolloProvider implements LeadSourceProviderContract {
  readonly provider = 'APOLLO' as const;

  private readonly logger = new Logger(ApolloProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.apollo.io/api/v1';

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('APOLLO_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('APOLLO_API_KEY is not configured');
    }
    this.apiKey = apiKey;
  }

  async search(input: LeadSourceSearchInput): Promise<ExternalLeadSearchResult> {
    const maxResults = this.clamp(input.targeting.maxResults, 1, 25);
    const searchPeople = await this.searchPeople(input, Math.min(maxResults, 25));
    if (!searchPeople.length) {
      return {
        provider: this.provider,
        providerRef: 'apollo:mixed_people/api_search',
        querySummary: {
          titleKeywords: input.targeting.titleKeywords,
          geoTargets: input.targeting.geoTargets,
          industries: input.targeting.industries,
          employeeRanges: input.targeting.employeeRanges,
          seniorities: input.targeting.seniorities,
        },
        prospects: [],
        importedCount: 0,
        sendableCount: 0,
      };
    }

    const enriched = await this.bulkEnrichPeople(searchPeople.slice(0, maxResults));
    const prospects = enriched
      .map((item, index) => this.toLeadCandidate(item, index, input))
      .filter((item): item is ExternalLeadCandidate => Boolean(item));

    return {
      provider: this.provider,
      providerRef: 'apollo:mixed_people/api_search',
      querySummary: {
        titleKeywords: input.targeting.titleKeywords,
        geoTargets: input.targeting.geoTargets,
        industries: input.targeting.industries,
        employeeRanges: input.targeting.employeeRanges,
        seniorities: input.targeting.seniorities,
      },
      prospects,
      importedCount: prospects.length,
      sendableCount: prospects.filter((item) => Boolean(item.email)).length,
    };
  }

  private async searchPeople(input: LeadSourceSearchInput, perPage: number): Promise<ApolloApiSearchPerson[]> {
    const url = new URL(`${this.baseUrl}/mixed_people/api_search`);
    const titles = this.uniqueNonEmpty(input.targeting.titleKeywords).slice(0, 10);
    const geoTargets = this.uniqueNonEmpty(input.targeting.geoTargets).slice(0, 10);
    const industries = this.uniqueNonEmpty(input.targeting.industries).slice(0, 5);
    const employeeRanges = this.uniqueNonEmpty(input.targeting.employeeRanges).slice(0, 5);
    const seniorities = this.uniqueNonEmpty(input.targeting.seniorities).slice(0, 5);

    for (const title of titles) url.searchParams.append('person_titles[]', title);
    for (const location of geoTargets) url.searchParams.append('organization_locations[]', location);
    for (const industry of industries) url.searchParams.append('organization_industries[]', industry);
    for (const range of employeeRanges) url.searchParams.append('organization_num_employees_ranges[]', range);
    for (const seniority of seniorities) url.searchParams.append('person_seniorities[]', seniority);
    url.searchParams.set('include_similar_titles', 'true');
    url.searchParams.set('contact_email_status[]', 'verified');
    url.searchParams.set('page', '1');
    url.searchParams.set('per_page', String(perPage));

    const keywords = this.buildKeywordQuery(input);
    if (keywords) {
      url.searchParams.set('q_keywords', keywords);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
    });

    if (!response.ok) {
      const message = await this.safeReadText(response);
      this.logger.warn(`Apollo people search failed (${response.status}): ${message}`);
      return [];
    }

    const payload = (await response.json()) as ApolloApiSearchResponse;
    return Array.isArray(payload.people) ? payload.people : [];
  }

  private async bulkEnrichPeople(items: ApolloApiSearchPerson[]): Promise<ApolloBulkMatchResponseItem[]> {
    if (!items.length) return [];

    const response = await fetch(`${this.baseUrl}/people/bulk_match`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        details: items.slice(0, 10).map((item) => ({
          id: item.id,
          first_name: item.first_name,
          last_name: item.last_name,
          name: item.name,
          title: item.title,
          organization_id: item.organization_id ?? item.organization?.id,
          domain: item.organization?.primary_domain,
        })),
      }),
    });

    if (!response.ok) {
      const message = await this.safeReadText(response);
      this.logger.warn(`Apollo bulk match failed (${response.status}): ${message}`);
      return items.map((item) => ({ person: this.toBulkFallbackPerson(item) }));
    }

    const payload = (await response.json()) as ApolloBulkMatchResponse;
    const matches = Array.isArray(payload.matches)
      ? payload.matches
      : Array.isArray(payload.people)
        ? payload.people
        : [];

    if (!matches.length) {
      return items.map((item) => ({ person: this.toBulkFallbackPerson(item) }));
    }

    return matches;
  }

  private toBulkFallbackPerson(item: ApolloApiSearchPerson) {
    return {
      id: item.id,
      first_name: item.first_name,
      last_name: item.last_name,
      name: item.name,
      title: item.title,
      email_status: item.email_status ?? null,
      linkedin_url: item.linkedin_url ?? null,
      city: item.city ?? null,
      state: item.state ?? null,
      country: item.country ?? null,
      organization: item.organization,
    };
  }

  private toLeadCandidate(
    item: ApolloBulkMatchResponseItem,
    index: number,
    input: LeadSourceSearchInput,
  ): ExternalLeadCandidate | null {
    const person = item.person;
    if (!person) return null;

    const fullName = this.readString(person.name)
      ?? [this.readString(person.first_name), this.readString(person.last_name)].filter(Boolean).join(' ')
      ?? 'Decision maker';
    const companyName = this.readString(person.organization?.name);
    if (!companyName) return null;

    const email = this.readString(person.email)?.toLowerCase() ?? undefined;
    const firstName = this.readString(person.first_name) ?? undefined;
    const lastName = this.readString(person.last_name) ?? undefined;
    const title = this.readString(person.title) ?? undefined;
    const domain = this.readString(person.organization?.primary_domain) ?? undefined;
    const industry = this.readString(person.organization?.industry) ?? input.targeting.industry ?? undefined;
    const region = this.readString(person.state) ?? undefined;
    const countryCode = this.normalizeCountry(this.readString(person.country));

    return {
      provider: this.provider,
      providerPersonId: this.readString(person.id) ?? undefined,
      providerOrganizationId: this.readString(person.organization?.id) ?? undefined,
      externalReference: this.readString(person.id) ?? undefined,
      companyName,
      domain,
      industry,
      employeeCount: typeof person.organization?.estimated_num_employees === 'number'
        ? person.organization.estimated_num_employees
        : undefined,
      contactFullName: fullName,
      firstName,
      lastName,
      title,
      email,
      emailStatus: this.readString(person.email_status) ?? undefined,
      linkedinUrl: this.readString(person.linkedin_url) ?? undefined,
      city: this.readString(person.city) ?? undefined,
      region,
      countryCode,
      reasonForFit: this.buildReasonForFit({
        title,
        industry,
        companyName,
        objective: input.targeting.objective,
      }),
      qualificationNotes: `Apollo matched ${fullName} at ${companyName} for ${input.targeting.campaignName ?? 'campaign'} via people search.`,
      priority: Math.max(100 - index * 5, 50),
      sourcePayload: {
        person,
      },
    };
  }

  private buildKeywordQuery(input: LeadSourceSearchInput) {
    const terms = this.uniqueNonEmpty([
      input.targeting.industry,
      input.targeting.offerSummary,
      input.targeting.objective,
      ...input.targeting.exclusionKeywords.map((item) => `-${item}`),
    ]).slice(0, 8);
    return terms.join(' ');
  }

  private buildReasonForFit(input: {
    title?: string;
    industry?: string;
    companyName: string;
    objective?: string;
  }) {
    const parts = [
      input.title ? `${input.title} role` : null,
      input.industry ? `within ${input.industry}` : null,
      input.objective ? `aligned to ${input.objective}` : null,
    ].filter(Boolean);

    return parts.length
      ? `${input.companyName} matched because it includes a ${parts.join(', ')}.`
      : `${input.companyName} matched the current campaign targeting.`;
  }

  private normalizeCountry(value: string | null) {
    if (!value) return undefined;
    const normalized = value.trim();
    if (normalized.length === 2) return normalized.toUpperCase();
    return normalized.slice(0, 2).toUpperCase();
  }

  private headers() {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
    };
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length ? value.trim() : null;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
  }

  private uniqueNonEmpty(values: Array<string | undefined | null>) {
    return Array.from(
      new Set(
        values
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean),
      ),
    );
  }

  private async safeReadText(response: Response) {
    try {
      return await response.text();
    } catch {
      return 'unable to read response body';
    }
  }
}
