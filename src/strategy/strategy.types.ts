export interface StrategyOutput {
  title: string;
  opportunityType: string;
  targetDescription: string;
  signalPriorities: string[];
  sourceOrder: string[];
  qualificationThresholds: {
    accept: number;
    hold: number;
  };
  fallback: {
    allowProviders: boolean;
    reasonCode: string;
  };
  outreachPosture: {
    channel: 'EMAIL';
    tone: 'professional';
    angle: string;
  };
  retryPolicy: {
    maxDiscoveryPasses: number;
    allowGeographyWidening: boolean;
  };
  planLimits: {
    maxDiscoveryEntities: number;
    maxExecutionQueue: number;
  };
}
