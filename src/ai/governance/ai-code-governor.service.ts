import { Injectable } from '@nestjs/common';
import { AiCodeUpgradeDto, AiDesignReviewDto } from '../contracts/ai-authority.contract';
import { AiEngineService } from '../core/ai-engine.service';

export interface AiCodeUpgradePlan {
  summary: string;
  architecturalJudgment: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  filesToReplace: Array<{ path: string; reason: string }>;
  filesToReadFirst: Array<{ path: string; reason: string }>;
  doNotTouch: string[];
  contractsToPreserve: string[];
  executionPlan: string[];
  validationPlan: string[];
  rollbackPlan: string[];
  aiMeta?: Record<string, unknown>;
}

export interface AiDesignReview {
  summary: string;
  truthSource: string[];
  primaryUser: string;
  allowedActions: string[];
  blockedActions: string[];
  emptyState: string;
  errorState: string;
  operatorVisibility: string[];
  copyRules: string[];
  layoutRules: string[];
  backendContractsNeeded: string[];
  aiMeta?: Record<string, unknown>;
}

@Injectable()
export class AiCodeGovernorService {
  constructor(private readonly ai: AiEngineService) {}

  async planCodeUpgrade(input: AiCodeUpgradeDto) {
    const longContext = this.ai.prepareLongContext({
      sourceType: 'code',
      label: 'code-governor',
      text: JSON.stringify(input, null, 2),
    });

    const result = await this.ai.structured<AiCodeUpgradePlan>({
      purpose: 'governance.code_upgrade',
      modelTier: 'code',
      systemPrompt: this.codePrompt(),
      input: {
        task: 'Plan a safe Orchestrate code upgrade.',
        input,
        longContext,
        boundary: {
          fullReplacementFilesOnly: true,
          preserveRoutes: true,
          preserveDbTruth: true,
          avoidStitchedPatches: true,
          readCurrentFilesBeforeReplacement: true,
        },
      },
      schema: {
        name: 'orchestrate_code_upgrade_plan',
        strict: true,
        schema: this.codePlanSchema(),
      },
      retries: 1,
    });

    return {
      ok: true,
      plan: {
        ...this.normalizeCodePlan(result.output),
        aiMeta: { provider: result.provider, model: result.model, usage: result.usage, warnings: result.warnings },
      },
      longContext,
    };
  }

  async reviewDesign(input: AiDesignReviewDto) {
    const result = await this.ai.structured<AiDesignReview>({
      purpose: 'governance.design_review',
      modelTier: 'reasoning',
      systemPrompt: this.designPrompt(),
      input: { task: 'Review or design an Orchestrate product surface.', input },
      schema: {
        name: 'orchestrate_design_review',
        strict: true,
        schema: this.designReviewSchema(),
      },
      retries: 1,
    });

    return {
      ok: true,
      review: {
        ...this.normalizeDesignReview(result.output),
        aiMeta: { provider: result.provider, model: result.model, usage: result.usage, warnings: result.warnings },
      },
    };
  }

  private codePrompt() {
    return [
      'You are Orchestrate AI Code Governor.',
      'You plan safe code upgrades for a NestJS/Prisma backend and Flutter frontend.',
      'Do not suggest stitched patches. The execution preference is whole replacement files or zipped replacement packages.',
      'Preserve existing routes, contracts, enum names, database reality, and working behavior unless explicitly replacing them.',
      'Prefer reading current files before replacement. Identify do-not-touch areas.',
      'Return strict JSON matching the supplied schema. No markdown.',
    ].join('\n');
  }

  private designPrompt() {
    return [
      'You are Orchestrate AI Product Design Governor.',
      'Design surfaces that represent backend truth. No developer-style helper text. No marketing fluff inside operational screens.',
      'Public is showcase/intake. Client is service reality and next action. Operator is visibility/control/debug.',
      'Return strict JSON matching the supplied schema. No markdown.',
    ].join('\n');
  }

  private codePlanSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'summary',
        'architecturalJudgment',
        'riskLevel',
        'filesToReplace',
        'filesToReadFirst',
        'doNotTouch',
        'contractsToPreserve',
        'executionPlan',
        'validationPlan',
        'rollbackPlan',
      ],
      properties: {
        summary: { type: 'string' },
        architecturalJudgment: { type: 'string' },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        filesToReplace: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'reason'],
            properties: { path: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        filesToReadFirst: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'reason'],
            properties: { path: { type: 'string' }, reason: { type: 'string' } },
          },
        },
        doNotTouch: { type: 'array', items: { type: 'string' } },
        contractsToPreserve: { type: 'array', items: { type: 'string' } },
        executionPlan: { type: 'array', items: { type: 'string' } },
        validationPlan: { type: 'array', items: { type: 'string' } },
        rollbackPlan: { type: 'array', items: { type: 'string' } },
      },
    };
  }

  private designReviewSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: [
        'summary',
        'truthSource',
        'primaryUser',
        'allowedActions',
        'blockedActions',
        'emptyState',
        'errorState',
        'operatorVisibility',
        'copyRules',
        'layoutRules',
        'backendContractsNeeded',
      ],
      properties: {
        summary: { type: 'string' },
        truthSource: { type: 'array', items: { type: 'string' } },
        primaryUser: { type: 'string' },
        allowedActions: { type: 'array', items: { type: 'string' } },
        blockedActions: { type: 'array', items: { type: 'string' } },
        emptyState: { type: 'string' },
        errorState: { type: 'string' },
        operatorVisibility: { type: 'array', items: { type: 'string' } },
        copyRules: { type: 'array', items: { type: 'string' } },
        layoutRules: { type: 'array', items: { type: 'string' } },
        backendContractsNeeded: { type: 'array', items: { type: 'string' } },
      },
    };
  }

  private normalizeCodePlan(value: Partial<AiCodeUpgradePlan>): AiCodeUpgradePlan {
    return {
      summary: this.text(value.summary, 'No summary returned.'),
      architecturalJudgment: this.text(value.architecturalJudgment, 'No architectural judgment returned.'),
      riskLevel: this.risk(value.riskLevel),
      filesToReplace: this.objectList(value.filesToReplace),
      filesToReadFirst: this.objectList(value.filesToReadFirst),
      doNotTouch: this.list(value.doNotTouch),
      contractsToPreserve: this.list(value.contractsToPreserve),
      executionPlan: this.list(value.executionPlan),
      validationPlan: this.list(value.validationPlan),
      rollbackPlan: this.list(value.rollbackPlan),
    };
  }

  private normalizeDesignReview(value: Partial<AiDesignReview>): AiDesignReview {
    return {
      summary: this.text(value.summary, 'No design summary returned.'),
      truthSource: this.list(value.truthSource),
      primaryUser: this.text(value.primaryUser, 'Unknown'),
      allowedActions: this.list(value.allowedActions),
      blockedActions: this.list(value.blockedActions),
      emptyState: this.text(value.emptyState, ''),
      errorState: this.text(value.errorState, ''),
      operatorVisibility: this.list(value.operatorVisibility),
      copyRules: this.list(value.copyRules),
      layoutRules: this.list(value.layoutRules),
      backendContractsNeeded: this.list(value.backendContractsNeeded),
    };
  }

  private text(value: unknown, fallback: string) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  private list(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
      : [];
  }

  private objectList(value: unknown): Array<{ path: string; reason: string }> {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({ path: this.text(item.path, ''), reason: this.text(item.reason, '') }))
      .filter((item) => item.path.length > 0);
  }

  private risk(value: unknown): AiCodeUpgradePlan['riskLevel'] {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return ['low', 'medium', 'high', 'critical'].includes(text) ? (text as AiCodeUpgradePlan['riskLevel']) : 'medium';
  }
}
