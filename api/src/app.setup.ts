import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from './config/env.js';

const REQUEST_BODY_LIMIT = '4kb';
const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.use(helmet());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    exposedHeaders: ['Retry-After'],
    maxAge: CORS_PREFLIGHT_MAX_AGE_SECONDS,
  });
  app.useBodyParser('json', { limit: REQUEST_BODY_LIMIT, inflate: false });
  app.setGlobalPrefix('api');
}
