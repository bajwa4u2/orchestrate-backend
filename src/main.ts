import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
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
  const tokenSecret = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.APP_SECRET?.trim();
  if (!tokenSecret) {
    throw new Error('Missing AUTH_TOKEN_SECRET or APP_SECRET');
  }
}

async function bootstrap() {
  validateCriticalEnvironment();

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet());

  app.enableCors({
    origin: resolveAllowedOrigins(),
    credentials: true,
  });

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
