import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';

function resolveAllowedOrigins() {
  const configured = process.env.CORS_ORIGIN
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured?.length) return configured;

  return [
    'https://orchestrateops.com',
    'https://www.orchestrateops.com',
    'https://app.orchestrateops.com',

    // 🔴 DEV: allow all localhost ports (Flutter, Vite, etc.)
    /^http:\/\/localhost:\d+$/,
  ];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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