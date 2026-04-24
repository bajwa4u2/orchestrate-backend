import {
  AiEngineRequest,
  AiEngineResult,
  AiProviderCapabilities,
  AiProviderName,
} from '../contracts/ai-core.contract';

export interface AiProvider {
  readonly name: AiProviderName;
  capabilities(): AiProviderCapabilities;
  run<T = unknown>(request: AiEngineRequest<T>): Promise<AiEngineResult<T>>;
}
