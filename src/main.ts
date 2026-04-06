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

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

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