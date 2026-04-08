import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

export interface StructuredGenerationOptions {
  model?: string;
  temperature?: number;
  systemPrompt: string;
  userPrompt: string;
}

@Injectable()
export class OpenAiProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI;
  private readonly primaryModel: string;
  private readonly fastModel: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException('OPENAI_API_KEY is not configured');
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: this.configService.get<string>('OPENAI_BASE_URL') || undefined,
      timeout: Number(this.configService.get<string>('OPENAI_TIMEOUT_MS') || 30000),
    });
    this.primaryModel = this.configService.get<string>('OPENAI_MODEL_PRIMARY') || 'gpt-4o';
    this.fastModel = this.configService.get<string>('OPENAI_MODEL_FAST') || 'gpt-4o-mini';
  }

  getPrimaryModel() {
    return this.primaryModel;
  }

  getFastModel() {
    return this.fastModel;
  }

  async generateStructured<T>(options: StructuredGenerationOptions): Promise<T> {
    const model = options.model || this.primaryModel;

    const completion = await this.client.chat.completions.create({
      model,
      temperature: options.temperature ?? 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: options.systemPrompt,
        },
        {
          role: 'user',
          content: options.userPrompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      this.logger.error(`No content returned from model ${model}`);
      throw new ServiceUnavailableException(`No AI response returned from model ${model}`);
    }

    try {
      return JSON.parse(content) as T;
    } catch (error) {
      this.logger.error(`Failed to parse JSON from model ${model}: ${String(error)}`);
      throw new ServiceUnavailableException('AI provider returned invalid structured JSON');
    }
  }
}
