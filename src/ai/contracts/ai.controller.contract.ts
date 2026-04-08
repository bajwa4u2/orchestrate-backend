export class ActivateGrowthWorkspaceDto {
  clientId!: string;
  workflowTitle?: string;
  setup!: {
    industry: string;
    country: string[];
    roles: string[];
    goal: string;
    regions?: string[];
    offer?: string;
    tone?: string;
    constraints?: string[];
  };
}

export class GenerateGrowthMessagesDto {
  clientId!: string;
  campaignId!: string;
  workflowRunId?: string;
  leads!: Array<{
    id: string;
    label?: string;
    role?: string;
    company?: string;
  }>;
  setup?: {
    industry?: string;
    country?: string[];
    roles?: string[];
    goal?: string;
    tone?: string;
  };
}

export class GenerateGrowthSequenceDto {
  clientId!: string;
  campaignId!: string;
  workflowRunId?: string;
  setup?: {
    industry?: string;
    country?: string[];
    roles?: string[];
    goal?: string;
    tone?: string;
  };
  context?: {
    campaignName?: string;
    offer?: string;
    desiredStepCount?: number;
  };
}

export class GenerateReminderDto {
  clientId!: string;
  context!: {
    invoiceId?: string;
    amount?: number;
    dueDate?: string;
    customerName?: string;
    note?: string;
  };
}

export class GenerateAgreementDraftDto {
  clientId!: string;
  context!: {
    service: string;
    terms?: string;
    effectiveDate?: string;
    billingCadence?: string;
    serviceScope?: string;
  };
}

export class GenerateStatementSummaryDto {
  clientId!: string;
  context!: {
    period: string;
    summaryData?: unknown;
    openingBalance?: number;
    closingBalance?: number;
    note?: string;
  };
}