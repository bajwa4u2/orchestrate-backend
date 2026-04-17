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
  email?: string | null;
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
  pagination?: {
    page?: number;
    per_page?: number;
    total_entries?: number;
    total_pages?: number;
  };
}

interface ApolloSingleMatchPerson {
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
}

interface ApolloSingleMatchResponse {
  person?: ApolloSingleMatchPerson;
  match?: ApolloSingleMatchPerson;
  contact?: ApolloSingleMatchPerson;
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
  private readonly searchProviderRef = 'apollo:mixed_people/api_search';

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('APOLLO_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('APOLLO_API_KEY is not configured');
    }
    this.apiKey = apiKey;
  }

  async search(input: LeadSourceSearchInput): Promise<ExternalLeadSearchResult> {
    const maxResults = this.clamp(input.targeting.maxResults, 1, 10);

    let searchPeople = await this.searchPeople(input, Math.min(maxResults, 10), {
      includeIndustries: true,
      includeSeniorities: true,
      includeEmployeeRanges: false,
      includeKeywords: true,
    });

    // One controlled fallback pass only if the strict pass returns nothing.
    if (!searchPeople.length) {
      searchPeople = await this.searchPeople(input, Math.min(maxResults, 10), {
        includeIndustries: false,
        includeSeniorities: true,
        includeEmployeeRanges: false,
        includeKeywords: false,
      });
    }

    if (!searchPeople.length) {
      return {
        provider: this.provider,
        providerRef: this.searchProviderRef,
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

    const sourcePeople = searchPeople.slice(0, maxResults);
    const enriched = await this.bulkEnrichPeople(sourcePeople);
    const enrichedWithEmailPass = await this.fillMissingEmails(enriched, sourcePeople);
    const prospects = enrichedWithEmailPass
      .map((item, index) => this.toLeadCandidate(item, sourcePeople[index], index, input))
      .filter((item): item is ExternalLeadCandidate => Boolean(item));

    this.logger.log(
      `Apollo search produced ${searchPeople.length} candidate people and ${prospects.length} mapped prospects (${prospects.filter((item) => Boolean(item.email)).length} with email).`,
    );

    return {
      provider: this.provider,
      providerRef: this.searchProviderRef,
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

  private async searchPeople(
    input: LeadSourceSearchInput,
    perPage: number,
    options: {
      includeIndustries: boolean;
      includeSeniorities: boolean;
      includeEmployeeRanges: boolean;
      includeKeywords: boolean;
    },
  ): Promise<ApolloApiSearchPerson[]> {
    const titles = this.uniqueNonEmpty(input.targeting.titleKeywords).slice(0, 8);
    const geoTargets = this.uniqueNonEmpty(input.targeting.geoTargets).slice(0, 8);
    const industries = this.uniqueNonEmpty(input.targeting.industries).slice(0, 3);
    const employeeRanges = this.uniqueNonEmpty(input.targeting.employeeRanges).slice(0, 3);
    const seniorities = this.uniqueNonEmpty(input.targeting.seniorities).slice(0, 3);
    const keywords = this.buildSearchKeywordQuery(input, {
      includeIndustries: options.includeIndustries,
      includeKeywords: options.includeKeywords,
    });

    const payload: Record<string, unknown> = {
      include_similar_titles: true,
      page: 1,
      per_page: perPage,
    };

    if (titles.length) {
      payload.person_titles = titles;
    }
    if (geoTargets.length) {
      payload.organization_locations = geoTargets;
    }
    if (options.includeEmployeeRanges && employeeRanges.length) {
      payload.organization_num_employees_ranges = employeeRanges;
    }
    if (options.includeSeniorities && seniorities.length) {
      payload.person_seniorities = seniorities;
    }
    if (keywords) {
      payload.q_keywords = keywords;
    }

    const response = await fetch(`${this.baseUrl}/mixed_people/api_search`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await this.safeReadText(response);
      this.logger.warn(`Apollo people search failed (${response.status}): ${message}`);
      return [];
    }

    const responseBody = (await response.json()) as ApolloApiSearchResponse;
    const people = Array.isArray(responseBody.people) ? responseBody.people : [];

    this.logger.log(
      `Apollo people search returned ${people.length} results (titles=${titles.length}, geos=${geoTargets.length}, industries=${options.includeIndustries ? industries.length : 0}, seniorities=${options.includeSeniorities ? seniorities.length : 0}, keywords=${keywords ? 'yes' : 'no'}).`,
    );

    return people;
  }

  private async fillMissingEmails(
    items: ApolloBulkMatchResponseItem[],
    sources: ApolloApiSearchPerson[],
  ): Promise<ApolloBulkMatchResponseItem[]> {
    if (!items.length) return items;

    const hydrated = [...items];
    let enrichmentAttempts = 0;
    let enrichmentWins = 0;

    for (let index = 0; index < hydrated.length; index += 1) {
      const current = hydrated[index];
      const source = sources[index];
      if (this.extractEmail(current?.person)) {
        continue;
      }

      const enrichedPerson = await this.singleEnrichPerson(source, current?.person);
      if (!enrichedPerson) {
        continue;
      }

      enrichmentAttempts += 1;
      if (this.extractEmail(enrichedPerson)) {
        enrichmentWins += 1;
      }
      hydrated[index] = { person: enrichedPerson };
    }

    if (enrichmentAttempts) {
      this.logger.log(
        `Apollo single enrichment retried ${enrichmentAttempts} missing-email candidates and recovered ${enrichmentWins} emails.`,
      );
    }

    return hydrated;
  }

  private async singleEnrichPerson(
    source: ApolloApiSearchPerson | undefined,
    current: ApolloSingleMatchPerson | undefined,
  ): Promise<ApolloSingleMatchPerson | null> {
    if (!source && !current) return null;

    const response = await fetch(`${this.baseUrl}/people/match`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        id: this.readString(current?.id) ?? this.readString(source?.id) ?? undefined,
        first_name: this.readString(current?.first_name) ?? this.readString(source?.first_name) ?? undefined,
        last_name: this.readString(current?.last_name) ?? this.readString(source?.last_name) ?? undefined,
        name: this.readString(current?.name) ?? this.readString(source?.name) ?? undefined,
        title: this.readString(current?.title) ?? this.readString(source?.title) ?? undefined,
        linkedin_url: this.readString(current?.linkedin_url) ?? this.readString(source?.linkedin_url) ?? undefined,
        organization_id:
          this.readString(source?.organization_id) ??
          this.readString(current?.organization?.id) ??
          this.readString(source?.organization?.id) ??
          undefined,
        organization_name:
          this.readString(current?.organization?.name) ??
          this.readString(source?.organization?.name) ??
          undefined,
        domain:
          this.readString(current?.organization?.primary_domain) ??
          this.readString(source?.organization?.primary_domain) ??
          undefined,
      }),
    });

    if (!response.ok) {
      return current ?? this.toBulkFallbackPerson(source ?? {});
    }

    const payload = (await response.json()) as ApolloSingleMatchResponse;
    return payload.person ?? payload.match ?? payload.contact ?? current ?? this.toBulkFallbackPerson(source ?? {});
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
      email: item.email ?? null,
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
    source: ApolloApiSearchPerson | undefined,
    index: number,
    input: LeadSourceSearchInput,
  ): ExternalLeadCandidate | null {
    const person = item.person ?? this.toBulkFallbackPerson(source ?? {});
    if (!person) return null;

    const fullName =
      this.readString(person.name) ||
      [this.readString(person.first_name), this.readString(person.last_name)].filter(Boolean).join(' ') ||
      this.readString(source?.name) ||
      [this.readString(source?.first_name), this.readString(source?.last_name)].filter(Boolean).join(' ') ||
      'Decision maker';
    const companyName =
      this.readString(person.organization?.name) ||
      this.readString(source?.organization?.name);
    if (!companyName) return null;

    const email = this.extractEmail(person) ?? this.extractEmail(source) ?? undefined;
    const firstName = this.readString(person.first_name) ?? this.readString(source?.first_name) ?? undefined;
    const lastName = this.readString(person.last_name) ?? this.readString(source?.last_name) ?? undefined;
    const title = this.readString(person.title) ?? this.readString(source?.title) ?? undefined;
    const domain =
      this.readString(person.organization?.primary_domain) ??
      this.readString(source?.organization?.primary_domain) ??
      undefined;
    const industry =
      this.readString(person.organization?.industry) ??
      this.readString(source?.organization?.industry) ??
      input.targeting.industry ??
      undefined;
    const city = this.readString(person.city) ?? this.readString(source?.city) ?? undefined;
    const region = this.readString(person.state) ?? this.readString(source?.state) ?? undefined;
    const countryCode =
      this.normalizeCountry(this.readString(person.country) ?? this.readString(source?.country));

    return {
      provider: this.provider,
      providerPersonId: this.readString(person.id) ?? undefined,
      providerOrganizationId: this.readString(person.organization?.id) ?? undefined,
      externalReference: this.readString(person.id) ?? undefined,
      companyName,
      domain,
      industry,
      employeeCount:
        typeof person.organization?.estimated_num_employees === 'number'
          ? person.organization.estimated_num_employees
          : undefined,
      contactFullName: fullName,
      firstName,
      lastName,
      title,
      email,
      emailStatus: this.readString(person.email_status) ?? undefined,
      linkedinUrl: this.readString(person.linkedin_url) ?? this.readString(source?.linkedin_url) ?? undefined,
      city,
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

  private buildSearchKeywordQuery(
    input: LeadSourceSearchInput,
    options: {
      includeIndustries: boolean;
      includeKeywords: boolean;
    },
  ) {
    const terms = this.uniqueNonEmpty([
      options.includeKeywords ? input.targeting.offerSummary : null,
      options.includeKeywords ? input.targeting.objective : null,
      ...(options.includeIndustries ? input.targeting.industries : []).slice(0, 3),
      ...(options.includeKeywords ? input.targeting.exclusionKeywords.map((item) => `-${item}`) : []),
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

  private extractEmail(
    input?: ApolloSingleMatchPerson | ApolloBulkMatchResponseItem['person'] | ApolloApiSearchPerson | null,
  ): string | undefined {
    const raw = input?.email;

    if (typeof raw !== 'string') return undefined;

    const email = raw.trim().toLowerCase();
    return email.length ? email : undefined;
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
