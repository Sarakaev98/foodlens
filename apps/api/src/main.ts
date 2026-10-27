import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadAppConfig } from './config/app-config';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const config = loadAppConfig(process.env);
  const app = await NestFactory.create(AppModule.register(config));
  app.enableCors();
  await app.listen(config.port);
}

void bootstrap();
