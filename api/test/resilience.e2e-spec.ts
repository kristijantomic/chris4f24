import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { api, createTestApp } from './support/test-app.js';

const UNAVAILABLE_BODY = {
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is temporarily unavailable'
  },
};

describe('database failures', () => {
  describe('when a query runs past the statement timeout', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({ env: { DB_STATEMENT_TIMEOUT_MS: '250' } });
    });
    afterAll(() => app.close());

    it('answers 503, then recovers', async () => {
      const blocker = new Pool({ connectionString: process.env['DATABASE_URL'] });
      const lockHolder = await blocker.connect();

      await lockHolder.query('BEGIN');
      await lockHolder.query('LOCK TABLE nodes IN ACCESS EXCLUSIVE MODE');

      const { body } = await api(app).get('/api/filesystem').expect(503);

      expect(body).toEqual(UNAVAILABLE_BODY);

      await lockHolder.query('ROLLBACK');

      lockHolder.release();

      await blocker.end();

      await api(app).get('/api/filesystem').expect(200);
    });
  });

  describe('when the database cannot be reached', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({
        pool: new Pool({
          connectionString: 'postgres://user:secret@127.0.0.1:1/none'
        }),
      });
    });
    afterAll(() => app.close());

    it.each(['/api/health', '/api/filesystem'])('answers 503 on %s and reveals nothing', async (path) => {
      const response = await api(app).get(path).expect(503);

      expect(response.body).toEqual(UNAVAILABLE_BODY);
      expect(response.text).not.toContain('secret');
      expect(response.text).not.toContain('127.0.0.1');
    });
  });
});
