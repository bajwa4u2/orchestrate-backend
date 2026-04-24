import { Injectable } from '@nestjs/common';
import { AiEvaluationSet } from '../contracts/ai-trust.contract';

@Injectable()
export class AiEvaluationCasesService {
  private readonly sets: AiEvaluationSet[] = [
    {
      id: 'orchestrate-authority-core-v2',
      title: 'Orchestrate Authority Core v2',
      description: 'Revenue authority tests across client, billing, agreement, campaign, lead, reply, meeting, and financial lifecycle.',
      version: '2.0.0',
      domains: ['authority_decision', 'structured_output', 'cost_control'],
      cases: [
        this.decisionCase('auth-block-no-email', 'Block outreach when lead has no usable email', { lead: { email: null, status: 'NEW' }, campaign: { status: 'ACTIVE' } }, { decision: 'BLOCK_ACTION', requiresOperatorReview: true, nextAction: 'REQUEST_VALID_EMAIL' }, 'Never send outreach without a reachable email.'),
        this.decisionCase('auth-block-suppressed-lead', 'Block outreach for suppressed/unsubscribed lead', { lead: { email: 'x@example.com', suppressed: true, unsubscribeReason: 'opt_out' }, campaign: { status: 'ACTIVE' } }, { decision: 'BLOCK_ACTION', requiresOperatorReview: true, nextAction: 'STOP_LEAD' }, 'Suppression and unsubscribe state is a hard blocker.'),
        this.decisionCase('auth-block-inactive-billing', 'Block campaign activation when subscription is inactive', { client: { subscriptionStatus: 'PAST_DUE' }, campaign: { status: 'READY' } }, { decision: 'BLOCK_ACTION', requiresOperatorReview: false, nextAction: 'REQUEST_PAYMENT' }, 'Billing is a hard gate for activation.'),
        this.decisionCase('auth-observe-missing-agreement', 'Suggest review when agreement is missing but billing is active', { client: { subscriptionStatus: 'ACTIVE', agreementStatus: 'MISSING' }, campaign: { status: 'READY' } }, { decision: 'SUGGEST_OPERATOR_REVIEW', requiresOperatorReview: true, nextAction: 'GENERATE_AGREEMENT' }, 'Missing agreement is advisory unless policy says hard block.'),
        this.decisionCase('auth-wait-pending-reply', 'Wait instead of follow-up when unprocessed reply exists', { lead: { status: 'CONTACTED' }, replies: [{ handledAt: null, intent: null }] }, { decision: 'WAIT', requiresOperatorReview: false, nextAction: 'PROCESS_REPLY' }, 'Pending inbound reply must stop follow-up automation.'),
        this.decisionCase('auth-meeting-no-booking-url', 'Escalate meeting handoff when booking path is missing', { lead: { status: 'INTERESTED' }, client: { bookingUrl: null } }, { decision: 'SUGGEST_OPERATOR_REVIEW', requiresOperatorReview: true, nextAction: 'REQUEST_BOOKING_PATH' }, 'Do not pretend a meeting can be booked when no path exists.'),
        this.decisionCase('auth-provider-cost-spike', 'Suggest source change when provider cost spikes', { providerUsage: { provider: 'apollo', creditsUsed: 2500, leadsWithEmail: 30 }, campaign: { targetLeads: 100 } }, { decision: 'SUGGEST_OPERATOR_REVIEW', requiresOperatorReview: true, nextAction: 'ADAPT_SOURCE_STRATEGY' }, 'Provider cost intelligence must protect unit economics.'),
        this.decisionCase('auth-invoice-overdue', 'Suggest payment reminder for overdue invoice', { invoice: { status: 'OVERDUE', daysOverdue: 7 }, client: { status: 'ACTIVE' } }, { decision: 'SUGGEST_ACTION', requiresOperatorReview: false, nextAction: 'SEND_PAYMENT_REMINDER' }, 'Financial lifecycle is part of revenue automation.'),
      ],
    },
    {
      id: 'orchestrate-system-doctor-v2',
      title: 'Orchestrate System Doctor v2',
      description: 'Diagnosis tests for backend, frontend/backend contract, DB migration, provider, Stripe/webhook, email, and Railway failures.',
      version: '2.0.0',
      domains: ['system_diagnosis', 'long_context'],
      cases: [
        this.diagnosisCase('doctor-prisma-migration-missing-column', 'Detect Prisma migration drift from missing column error', { logs: ['PrismaClientKnownRequestError: The column `Lead.lastReplyAt` does not exist in the current database.'] }, { affectedLayer: 'database', likelyRootCause: 'migration_drift' }),
        this.diagnosisCase('doctor-frontend-db-truth-mismatch', 'Detect frontend/backend response mismatch from empty UI with populated DB', { symptoms: ['client workspace screen empty', 'database has campaigns and leads', 'API returns 200 with different shape than frontend expects'] }, { affectedLayer: 'frontend_backend_contract', likelyRootCause: 'response_shape_mismatch' }),
        this.diagnosisCase('doctor-provider-422', 'Detect provider query problem from 422 response', { logs: ['Apollo people search failed (422): {"error":"Value too long"}'], context: { titles: 40, geos: 18 } }, { affectedLayer: 'provider', likelyRootCause: 'provider_query_too_broad_or_invalid' }),
        this.diagnosisCase('doctor-stripe-webhook-signature', 'Detect Stripe webhook signature/config issue', { logs: ['StripeSignatureVerificationError: No signatures found matching expected signature for payload'], env: { webhookSecretPresent: false } }, { affectedLayer: 'billing_webhook', likelyRootCause: 'missing_or_wrong_webhook_secret' }),
        this.diagnosisCase('doctor-email-suppression', 'Detect email delivery suppression path', { logs: ['Resend API error: recipient suppressed', 'FirstSendWorker failed after send attempt'] }, { affectedLayer: 'email_deliverability', likelyRootCause: 'recipient_suppressed_or_invalid' }),
        this.diagnosisCase('doctor-railway-internal-db-local', 'Detect Railway internal database URL used locally', { logs: ['P1001: Can\'t reach database server at postgres.railway.internal:5432'], context: { runningLocally: true } }, { affectedLayer: 'environment', likelyRootCause: 'railway_internal_database_url_used_outside_railway' }),
      ],
    },
    {
      id: 'orchestrate-governance-core-v2',
      title: 'Orchestrate Governance Core v2',
      description: 'Code and design governance discipline for whole-file replacement, no rushed shortening, backend truth, and client-facing language.',
      version: '2.0.0',
      domains: ['code_governance', 'design_governance'],
      cases: [
        this.codeCase('code-whole-file-no-patch-discipline', 'Code governor preserves whole-file replacement discipline', { request: 'fix campaign screen truth mismatch', constraints: ['whole replacement files only', 'review current files first', 'do not shorten files'] }, { replacementMode: 'whole_files', requiresCurrentFileReview: true }),
        this.codeCase('code-do-not-touch-working-routes', 'Code governor protects working routes and contracts', { request: 'add AI authority endpoints', workingContracts: ['/client/workspace', '/operator', '/v1/auth/login'] }, { replacementMode: 'whole_files', requiresCurrentFileReview: true }),
        this.designCase('design-db-truth-first', 'Design governor enforces frontend as DB truth representation', { screen: 'client dashboard', proposal: 'show marketing cards only, no campaign data or blockers' }, { verdict: 'needs_revision', principle: 'backend_truth_representation' }),
        this.designCase('design-no-devish-language', 'Design governor removes developer-style UI language', { surface: 'client onboarding', copy: 'Malformed payload. Please provide a valid DTO.' }, { verdict: 'needs_revision', principle: 'client_facing_operational_language' }),
      ],
    },
    {
      id: 'orchestrate-ai-core-survivability-v1',
      title: 'Orchestrate AI Core Survivability v1',
      description: 'Provider routing, strict structure, cost control, long-context, and self-correction trust tests.',
      version: '1.0.0',
      domains: ['provider_routing', 'structured_output', 'cost_control', 'long_context', 'classification'],
      cases: [
        this.coreCase('core-schema-repair-required', 'Reject or repair malformed structured output', 'Return strict JSON matching schema when previous output had extra fields.', { decision: 'WAIT', reason: 'Pending reply exists.', confidence: 0.88 }),
        this.coreCase('core-cost-awareness', 'Recognize cost-sensitive provider use', 'Recommend lower-cost model/source when task is simple classification.', { decision: 'USE_FAST_MODEL', reason: 'Classification does not require high reasoning model.', confidence: 0.86 }),
        this.coreCase('core-long-context-har', 'Summarize HAR/log context without losing root signal', 'Detect response shape mismatch from long HAR summary.', { affectedLayer: 'frontend_backend_contract', likelyRootCause: 'response_shape_mismatch', confidence: 0.82 }),
        this.coreCase('core-reply-classification', 'Classify reply into actionable next step', 'Classify positive buyer reply and recommend meeting handoff.', { intent: 'POSITIVE', nextAction: 'HANDOFF_MEETING', confidence: 0.85 }),
      ],
    },
  ];

  listSets() {
    return this.sets.map((set) => ({
      id: set.id,
      title: set.title,
      description: set.description,
      version: set.version,
      domains: set.domains,
      caseCount: set.cases.length,
    }));
  }

  getSet(id: string) {
    return this.sets.find((set) => set.id === id) ?? null;
  }

  select(input: { setId?: string; caseIds?: string[]; domains?: string[]; maxCases?: number }) {
    let cases = input.setId ? (this.getSet(input.setId)?.cases ?? []) : this.sets.flatMap((set) => set.cases);
    if (input.caseIds?.length) cases = cases.filter((testCase) => input.caseIds?.includes(testCase.id));
    if (input.domains?.length) cases = cases.filter((testCase) => input.domains?.includes(testCase.domain));
    if (input.maxCases && input.maxCases > 0) cases = cases.slice(0, input.maxCases);
    return cases;
  }

  setIdsForCases(caseIds: string[]) {
    return this.sets.filter((set) => set.cases.some((testCase) => caseIds.includes(testCase.id))).map((set) => set.id);
  }

  private decisionCase(id: string, title: string, input: unknown, expected: unknown, rule: string) {
    return {
      id,
      title,
      domain: 'authority_decision' as const,
      purpose: 'authority.decision' as const,
      capability: 'REVENUE_DECISION' as const,
      modelTier: 'reasoning' as const,
      description: rule,
      systemPrompt: `You are Orchestrate AI authority. ${rule} Distinguish hard blockers from advisory risks.`,
      input,
      expected,
      schema: this.basicDecisionSchema(),
      minimumScore: 0.84,
      tags: ['authority', 'revenue'],
    };
  }

  private diagnosisCase(id: string, title: string, input: unknown, expected: unknown) {
    return {
      id,
      title,
      domain: 'system_diagnosis' as const,
      purpose: 'intelligence.system_doctor' as const,
      capability: 'SYSTEM_DIAGNOSIS' as const,
      modelTier: 'long_context' as const,
      description: 'Diagnose the root cause from operational evidence.',
      systemPrompt: 'You are Orchestrate System Doctor. Diagnose root cause from logs and return structured result with proof and safe fix plan.',
      input,
      expected,
      schema: this.basicDiagnosisSchema(),
      minimumScore: 0.82,
      tags: ['doctor', 'diagnosis'],
    };
  }

  private codeCase(id: string, title: string, input: unknown, expected: unknown) {
    return {
      id,
      title,
      domain: 'code_governance' as const,
      purpose: 'governance.code_upgrade' as const,
      capability: 'CODE_GOVERNANCE' as const,
      modelTier: 'code' as const,
      description: 'Govern code upgrade planning with careful whole-file discipline.',
      systemPrompt: 'You are Orchestrate Code Governor. Never suggest stitched patches. Review current files first. Preserve working structure and provide whole replacement file plans only.',
      input,
      expected,
      schema: this.basicCodePlanSchema(),
      minimumScore: 0.8,
      tags: ['code', 'governance'],
    };
  }

  private designCase(id: string, title: string, input: unknown, expected: unknown) {
    return {
      id,
      title,
      domain: 'design_governance' as const,
      purpose: 'governance.design_review' as const,
      capability: 'DESIGN_GOVERNANCE' as const,
      modelTier: 'reasoning' as const,
      description: 'Govern product design with backend truth and mature client-facing language.',
      systemPrompt: 'You are Orchestrate Design Governor. Product screens must represent backend truth and avoid developer-style explanatory copy.',
      input,
      expected,
      schema: this.basicDesignReviewSchema(),
      minimumScore: 0.8,
      tags: ['design', 'truth'],
    };
  }

  private coreCase(id: string, title: string, instruction: string, expected: unknown) {
    return {
      id,
      title,
      domain: 'structured_output' as const,
      purpose: 'evaluation.trust' as const,
      capability: 'EVALUATION' as const,
      modelTier: 'reasoning' as const,
      description: instruction,
      systemPrompt: 'You are testing Orchestrate AI core reliability. Return only strict JSON matching the schema.',
      input: { instruction },
      expected,
      schema: this.genericEvalSchema(),
      minimumScore: 0.78,
      tags: ['core', 'survivability'],
    };
  }

  private basicDecisionSchema() {
    return {
      name: 'orchestrate_authority_decision_eval',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decision: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
          requiresOperatorReview: { type: 'boolean' },
          nextAction: { type: 'string' },
        },
        required: ['decision', 'reason', 'confidence', 'requiresOperatorReview', 'nextAction'],
      },
    };
  }

  private basicDiagnosisSchema() {
    return {
      name: 'orchestrate_system_doctor_eval',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          affectedLayer: { type: 'string' },
          likelyRootCause: { type: 'string' },
          confidence: { type: 'number' },
          proof: { type: 'array', items: { type: 'string' } },
          fixPlan: { type: 'array', items: { type: 'string' } },
          riskLevel: { type: 'string' },
        },
        required: ['affectedLayer', 'likelyRootCause', 'confidence', 'proof', 'fixPlan', 'riskLevel'],
      },
    };
  }

  private basicCodePlanSchema() {
    return {
      name: 'orchestrate_code_governance_eval',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          replacementMode: { type: 'string' },
          requiresCurrentFileReview: { type: 'boolean' },
          doNotTouch: { type: 'array', items: { type: 'string' } },
          plan: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['replacementMode', 'requiresCurrentFileReview', 'doNotTouch', 'plan', 'confidence'],
      },
    };
  }

  private basicDesignReviewSchema() {
    return {
      name: 'orchestrate_design_governance_eval',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          verdict: { type: 'string' },
          principle: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
          requiredChanges: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' },
        },
        required: ['verdict', 'principle', 'issues', 'requiredChanges', 'confidence'],
      },
    };
  }

  private genericEvalSchema() {
    return {
      name: 'orchestrate_generic_trust_eval',
      strict: false,
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          decision: { type: 'string' },
          intent: { type: 'string' },
          affectedLayer: { type: 'string' },
          likelyRootCause: { type: 'string' },
          nextAction: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['confidence'],
      },
    };
  }
}
