import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { PG_POOL } from '../../src/database/database.module.js';

export const ALLOWED_ORIGIN = 'http://localhost:3001';
export const UNKNOWN_ID = '019a0000-0000-7000-8000-0000000000ff';

const TEST_ENV = {
  CORS_ORIGINS: ALLOWED_ORIGIN,
  RATE_LIMIT_MAX: '1000000',
};

interface TestAppOptions {
  env?: Record<string, string>;
  pool?: Pool;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  Object.assign(process.env, TEST_ENV, options.env);

  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (options.pool) builder.overrideProvider(PG_POOL).useValue(options.pool);

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });

  configureApp(app);

  await app.listen(0);

  return app;
}

export const api = (app: NestExpressApplication) => request(app.getHttpServer());

export const poolOf = (app: NestExpressApplication): Pool => app.get<Pool>(PG_POOL);

export async function clearNodes(app: NestExpressApplication): Promise<void> {
  await poolOf(app).query('DELETE FROM nodes');
}

async function createNode(
  app: NestExpressApplication,
  path: string,
  name: string,
  parentId: string | null,
): Promise<string> {
  const response = await api(app).post(path).send({ name, parentId }).expect(201);
  
  return response.body.id;
}

export const createFolder = (app: NestExpressApplication, name: string, parentId: string | null = null) =>
  createNode(app, '/api/filesystem/folders', name, parentId);

export const createFile = (app: NestExpressApplication, name: string, parentId: string | null = null) =>
  createNode(app, '/api/filesystem/files', name, parentId);
