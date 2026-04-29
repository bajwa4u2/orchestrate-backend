import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { structuredLog } from './common/observability/structured-logger';

function resolveAllowedOrigins() {
  const configured = (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || process.env.APP_BASE_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins: Array<string | RegExp> = configured.length
    ? configured
    : [
        'https://orchestrateops.com',
        'https://www.orchestrateops.com',
        'https://app.orchestrateops.com',
      ];

  if (process.env.NODE_ENV !== 'production') {
    origins.push(/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/);
  }

  return origins;
}

function validateCriticalEnvironment() {
  const hasTokenSecret = Boolean(process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim());
  if (!hasTokenSecret) {
    throw new Error('Missing AUTH_TOKEN_SECRET or APP_SECRET');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const allowsSystemHeaders = (process.env.ALLOW_SYSTEM_HEADER_CONTEXT?.trim() || '').toLowerCase() === 'true';

  if (isProduction && allowsSystemHeaders && !process.env.SYSTEM_HEADER_CONTEXT_SECRET?.trim()) {
    throw new Error('ALLOW_SYSTEM_HEADER_CONTEXT requires SYSTEM_HEADER_CONTEXT_SECRET in production');
  }

  if (isProduction && !process.env.INBOUND_REPLY_SECRET?.trim()) {
    throw new Error('INBOUND_REPLY_SECRET is required in production');
  }

  if (isProduction && !process.env.RESEND_WEBHOOK_SECRET?.trim()) {
    throw new Error('RESEND_WEBHOOK_SECRET is required in production');
  }

  if (isProduction && !process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required in production');
  }

  const rateLimitStore = (process.env.RATE_LIMIT_STORE?.trim() || 'memory').toLowerCase();
  const allowMemoryFallback = (process.env.ALLOW_IN_MEMORY_RATE_LIMITER?.trim() || '').toLowerCase() === 'true';
  if (isProduction && rateLimitStore === 'memory' && !allowMemoryFallback) {
    throw new Error('RATE_LIMIT_STORE=memory requires ALLOW_IN_MEMORY_RATE_LIMITER=true in production');
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
    const inboundCorrelationId = readRequestHeader(req.headers, 'x-correlation-id');
    const inboundRequestId = readRequestHeader(req.headers, 'x-request-id');
    const requestId = sanitizeExternalId(inboundRequestId) ?? randomUUID();
    const correlationId = sanitizeExternalId(inboundCorrelationId) ?? requestId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-correlation-id', correlationId);
    req.requestId = requestId;
    req.correlationId = correlationId;

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
      structuredLog('warn', 'rate_limit.blocked', {
        requestId,
        correlationId,
        path,
        ip,
      });
      res.status(429).json({
        ok: false,
        error: 'Too many requests',
        requestId,
        correlationId,
      });
      return;
    }

    current.count += 1;
    buckets.set(bucketKey, current);
    next();
  };
}

function readRequestHeader(headers: Record<string, unknown> | undefined, key: string) {
  const raw = headers?.[key] ?? headers?.[key.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]).trim() : undefined;
  if (raw == null) return undefined;
  const value = String(raw).trim();
  return value.length ? value : undefined;
}

function sanitizeExternalId(value?: string) {
  if (!value) return undefined;
  const clean = value.trim();
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(clean)) return undefined;
  return clean;
}

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request?.requestId || response?.getHeader?.('x-request-id') || randomUUID();
    const correlationId = request?.correlationId || response?.getHeader?.('x-correlation-id') || requestId;
    const body = exception instanceof HttpException ? exception.getResponse() : null;
    const message = this.safeMessage(status, body);
    structuredLog(status >= 500 ? 'error' : 'warn', 'api.error', {
      requestId,
      correlationId,
      statusCode: status,
      method: request?.method,
      path: request?.originalUrl || request?.url,
      errorName: exception instanceof Error ? exception.name : 'UnknownError',
    });

    response.status(status).json({
      ok: false,
      statusCode: status,
      error: message,
      requestId,
      correlationId,
    });
  }

  private safeMessage(status: number, body: unknown) {
    if (status >= 500) return 'Internal server error';
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const message = record.message;
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
      if (typeof record.error === 'string') return record.error;
    }
    return 'Request failed';
  }
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
    maxAge: Number(process.env.CORS_MAX_AGE_SECONDS || 600),
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
  app.useGlobalFilters(new SafeExceptionFilter());

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  console.log(`Orchestrate backend running on http://localhost:${port}/v1`);
}

bootstrap();
