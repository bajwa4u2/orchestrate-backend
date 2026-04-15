import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';

function resolveAllowedOrigins() {
  return [
    'http://localhost:3001',
    'https://orchestrateops.com',
    'https://www.orchestrateops.com',
    'https://app.orchestrateops.com',
    /^http:\/\/localhost:\d+$/,
  ];
}

function validateCriticalEnvironment() {
  const hasTokenSecret = Boolean(process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim());
  if (!hasTokenSecret) {
    throw new Error('Missing AUTH_TOKEN_SECRET or APP_SECRET');
  }
}

type RateRule = {
  pattern: RegExp;
  limit: number;
  windowMs: number;
};

function createLaunchProtectionMiddleware() {
  const rules: RateRule[] = [
    { pattern: /^\/v1\/auth\//, limit: 20, windowMs: 15 * 60 * 1000 },
    { pattern: /^\/v1\/public\/(contact|intake)/, limit: 30, windowMs: 10 * 60 * 1000 },
    { pattern: /^\/v1\/client\/support\/intake/, limit: 30, windowMs: 10 * 60 * 1000 },
    { pattern: /^\/v1\/replies\/inbound/, limit: 60, windowMs: 5 * 60 * 1000 },
  ];
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: any, res: any, next: () => void) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    req.requestId = requestId;

    const path = String(req.originalUrl || req.url || '');
    const matchedRule = rules.find((rule) => rule.pattern.test(path));
    if (!matchedRule) {
      next();
      return;
    }

    const forwardedFor = req.headers?.['x-forwarded-for'];
    const ip = Array.isArray(forwardedFor)
      ? String(forwardedFor[0])
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : String(req.ip || req.socket?.remoteAddress || 'unknown');
    const bucketKey = `${matchedRule.pattern.source}:${ip}`;
    const now = Date.now();
    const current = buckets.get(bucketKey);

    if (!current || now >= current.resetAt) {
      buckets.set(bucketKey, { count: 1, resetAt: now + matchedRule.windowMs });
      next();
      return;
    }

    if (current.count >= matchedRule.limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((current.resetAt - now) / 1000)).toString());
      res.status(429).json({
        ok: false,
        error: 'Too many requests',
        requestId,
      });
      return;
    }

    current.count += 1;
    buckets.set(bucketKey, current);
    next();
  };
}

async function bootstrap() {
  validateCriticalEnvironment();

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  app.use(helmet());
  app.use(createLaunchProtectionMiddleware());

  app.enableCors({
    origin: resolveAllowedOrigins(),
    credentials: true,
  });

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  console.log(`Orchestrate backend running on http://localhost:${port}/v1`);
}

bootstrap();
