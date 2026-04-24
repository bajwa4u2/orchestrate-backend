import { Injectable } from '@nestjs/common';
import { AiContextEntry } from '../contracts/ai-core.contract';

@Injectable()
export class AiContextManagerService {
  private readonly memory = new Map<string, AiContextEntry>();

  get(key: string) {
    return this.memory.get(key) ?? null;
  }

  append(
    key: string,
    turn: {
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    const now = new Date().toISOString();
    const existing = this.memory.get(key) ?? {
      key,
      createdAt: now,
      updatedAt: now,
      turns: [],
      summary: null,
      metadata: {},
    };

    existing.turns.push({ ...turn, at: now });
    existing.updatedAt = now;

    if (existing.turns.length > 30) {
      existing.summary = this.basicSummary(existing);
      existing.turns = existing.turns.slice(-20);
    }

    this.memory.set(key, existing);
    return existing;
  }

  clear(key: string) {
    this.memory.delete(key);
  }

  private basicSummary(entry: AiContextEntry) {
    const last = entry.turns.slice(-10).map((turn) => `${turn.role}: ${turn.content.slice(0, 240)}`).join('\n');
    return ['Recent AI context summary:', last].join('\n');
  }
}
