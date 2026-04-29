export type IntakeSource = 'PUBLIC' | 'CLIENT';

export interface NormalizedIntakeInput {
  source: IntakeSource;

  name?: string | null;
  email?: string | null;
  company?: string | null;

  userId?: string | null;
  clientId?: string | null;

  message: string;

  sourcePage?: string | null;
  planContext?: 'opportunity' | 'revenue' | null;
  tierContext?: 'focused' | 'multi' | 'precision' | null;

  inquiryTypeHint?: string | null;
  subscriptionStatus?: string | null;
}

export interface IntakeAiResult {
  category:
    | 'pricing'
    | 'billing'
    | 'support'
    | 'technical'
    | 'onboarding'
    | 'sales'
    | 'partnership'
    | 'compliance'
    | 'other';
  intent: 'question' | 'issue' | 'request' | 'complaint';
  priority: 'low' | 'medium' | 'high';
  confidence: number;
  requiresHuman: boolean;
  shouldAskFollowUp: boolean;
  summary: string;
  suggestedReply: string;
  missingFields: string[];
  followUpQuestions: string[];
}

export type IntakeStatus = 'resolved' | 'needs_follow_up' | 'escalated';

export interface IntakeResponse {
  status: IntakeStatus;
  reply: string;
  questions: string[];
  caseCreated: boolean;
  caseId: string | null;
  sessionId: string | null;
  sessionToken?: string | null;
  category: string;
  priority: string;
}
