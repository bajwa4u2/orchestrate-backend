export interface NormalizedSignal {
  signalType: string;
  signalSourceType: string;
  sourceUrlOrKey?: string;
  headlineOrLabel: string;
  geography?: string;
  recencyScore: number;
  confidenceScore: number;
  payloadJson: Record<string, unknown>;
  normalizedJson: Record<string, unknown>;
}
