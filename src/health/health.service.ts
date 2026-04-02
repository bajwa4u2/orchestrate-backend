import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    const now = new Date().toISOString();
    const db = await this.prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
    return {
      ok: true,
      service: 'orchestrate-backend',
      phase: 'execution-core',
      timestamp: now,
      database: db?.[0]?.ok === 1 ? 'connected' : 'unknown',
    };
  }
}
