import type { NestExpressApplication } from '@nestjs/platform-express';
import { ALLOWED_ORIGIN, api, createTestApp } from './support/test-app.js';

const LIMIT = 5;

// Limits are per route and client, and nothing resets them between tests, so
// each test below uses up its own route.
describe('rate limiting', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ env: { RATE_LIMIT_MAX: String(LIMIT) } });
  });
  afterAll(() => app.close());

  it('answers 429 past the limit, and an attacker cannot escape it with a spoofed IP', async () => {
    const list = '/api/filesystem';
    
    for (let i = 0; i < LIMIT; i++) await api(app).get(list).expect(200);

    const blocked = await api(app).get(list).set('Origin', ALLOWED_ORIGIN).expect(429);

    expect(blocked.body).toEqual({
      error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(blocked.headers['access-control-expose-headers']).toContain('Retry-After');

    await api(app).get(list).set('X-Forwarded-For', '9.9.9.9').expect(429);
  });

  it('does not count CORS preflights', async () => {
    const search = '/api/filesystem/search?name=a';
    for (let i = 0; i < LIMIT * 2; i++) {
      await api(app)
        .options(search)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
    }

    await api(app).get(search).expect(200);
  });

  it('never limits the health check', async () => {
    for (let i = 0; i < LIMIT * 2; i++) await api(app).get('/api/health').expect(200);
  });
});
