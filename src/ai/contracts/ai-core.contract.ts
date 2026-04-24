import { AiAuthorityScope } from './ai-authority.contract';

export type AiCapability =
  | 'TEXT_GENERATION'
  | 'STRUCTURED_OUTPUT'
  | 'REVENUE_DECISION'
  | 'SYSTEM_DIAGNOSIS'
  | 'CODE_GOVERNANCE'
  | 'DESIGN_GOVERNANCE'
  | 'CLASSIFICATION'
  | 'LONG_CONTEXT_REASONING'
  | 'EMBEDDING'
  | 'MODERATION'
  | 'SPEECH_TO_TEXT'
  | 'TEXT_TO_SPEECH'
  | 'REALTIME_SESSION'
  | 'IMAGE_UNDERSTANDING'
  | 'FILE_REASONING'
  | 'TOOL_PLANNING'
  | 'EVALUATION'
  | 'SELF_CORRECTION'
  | 'SELF_IMPROVEMENT'
  | 'AUTONOMY_PLANNING';

export type AiPurpose =
  | 'generation.message'
  | 'generation.strategy'
  | 'generation.leads'
  | 'generation.sequence'
  | 'generation.revenue_draft'
  | 'authority.decision'
  | 'intelligence.system_doctor'
  | 'governance.code_upgrade'
  | 'governance.design_review'
  | 'classification.reply'
  | 'classification.intake'
  | 'analysis.long_context'
  | 'moderation.safety'
  | 'embedding.semantic'
  | 'speech.transcription'
  | 'speech.synthesis'
  | 'realtime.session'
  | 'evaluation.trust'
  | 'evaluation.judge'
  | 'autonomy.trigger_plan'
  | 'autonomy.self_correction'
  | 'autonomy.self_improvement';

export type AiProviderName = 'openai' | 'anthropic' | 'google' | 'local' | string;

export type AiModelTier = 'fast' | 'balanced' | 'reasoning' | 'code' | 'long_context' | 'realtime' | 'embedding' | 'moderation' | 'speech' | 'vision';

export interface AiJsonSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface AiEngineRequest<T = unknown> {
  purpose: AiPurpose;
  capability: AiCapability;
  scope?: AiAuthorityScope;
  systemPrompt: string;
  userPrompt?: string;
  input?: unknown;
  schema?: AiJsonSchema;
  tools?: AiToolDefinition[];
  model?: string;
  modelTier?: AiModelTier;
  provider?: AiProviderName;
  temperature?: number;
  maxOutputTokens?: number;
  contextKey?: string;
  entity?: {
    organizationId?: string | null;
    clientId?: string | null;
    campaignId?: string | null;
    leadId?: string | null;
    jobId?: string | null;
    workflowRunId?: string | null;
  };
  metadata?: Record<string, unknown>;
  retries?: number;
  allowRepair?: boolean;
  expect?: 'text' | 'json' | 'tool_plan';
  fallback?: T;
}

export interface AiUsageRecord {
  provider: AiProviderName;
  model: string;
  purpose: AiPurpose;
  capability: AiCapability;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  requestId?: string | null;
}

export interface AiEngineResult<T = unknown> {
  ok: boolean;
  provider: AiProviderName;
  model: string;
  purpose: AiPurpose;
  capability: AiCapability;
  output: T;
  text?: string | null;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: AiUsageRecord;
  confidence?: number | null;
  warnings: string[];
  raw?: unknown;
}

export interface AiProviderCapabilities {
  provider: AiProviderName;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  supportsModeration: boolean;
  supportsSpeechToText: boolean;
  supportsTextToSpeech: boolean;
  supportsRealtime: boolean;
  supportsVision: boolean;
  supportsFiles: boolean;
  supportsReasoningEffort: boolean;
}

export interface AiContextEntry {
  key: string;
  createdAt: string;
  updatedAt: string;
  turns: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    metadata?: Record<string, unknown>;
    at: string;
  }>;
  summary?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AiLongContextChunk {
  index: number;
  label: string;
  text: string;
  tokenEstimate: number;
  metadata?: Record<string, unknown>;
}

export interface AiLongContextSummary {
  sourceType: 'logs' | 'har' | 'code' | 'db' | 'mixed' | 'unknown';
  chunkCount: number;
  totalTokenEstimate: number;
  executiveSummary: string;
  keyFindings: string[];
  risks: string[];
  suggestedNextQuestions: string[];
  chunks: AiLongContextChunk[];
}
