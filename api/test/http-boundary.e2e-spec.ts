import { gzipSync } from 'node:zlib';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ALLOWED_ORIGIN, api, clearNodes, createTestApp, UNKNOWN_ID } from './support/test-app.js';

const LIST = '/api/filesystem';
const FOLDERS = '/api/filesystem/folders';
const JSON_TYPE = 'application/json';
const ALLOW_ORIGIN = 'access-control-allow-origin';

describe('HTTP boundary', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => clearNodes(app));
  afterAll(() => app.close());

  const postRaw = (contentType: string, body: string | Buffer) =>
    api(app).post(FOLDERS).set('Content-Type', contentType).send(body);

  describe('security headers', () => {
    it.each([
      'x-content-type-options',
      'strict-transport-security',
      'content-security-policy'
    ])('sets %s', async (header) => {
        const response = await api(app).get('/api/health').expect(200);
        
        expect(response.headers).toHaveProperty(header);
      },
    );

    it('does not reveal the framework', async () => {
      const response = await api(app).get('/api/health').expect(200);

      expect(response.headers).not.toHaveProperty('x-powered-by');
    });
  });

  describe('request bodies', () => {
    it.each([
      ['text/plain', '{"name":"x"}'],
      ['application/x-www-form-urlencoded', 'name=x'],
      ['multipart/form-data; boundary=b', '--b--'],
      ['application/xml', '<a/>'],
    ])('answers 415 for %s', async (contentType, body) => {
      const response = await postRaw(contentType, body).expect(415);

      expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('accepts JSON with a charset and in mixed case', async () => {
      await postRaw(`${JSON_TYPE}; charset=utf-8`, '{"name":"a"}').expect(201);
      await postRaw('Application/JSON', '{"name":"b"}').expect(201);
    });

    it('refuses compressed bodies', async () => {
      await postRaw(JSON_TYPE, gzipSync('{"name":"x"}'))
              .set('Content-Encoding', 'gzip').expect(415);
    });

    it('answers 413 for a body over the limit', async () => {
      const response = await api(app)
        .post(FOLDERS)
        .send({ name: 'a'.repeat(5_000) })
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('answers 400 for malformed JSON without echoing it', async () => {
      const response = await postRaw(JSON_TYPE, '{"name": "input-marker"').expect(400);

      expect(response.text).not.toContain('input-marker');
      expect(response.text).not.toContain('stack');
    });

    it('rejects a __proto__ key and does not pollute objects', async () => {
      await postRaw(JSON_TYPE, '{"name":"x","__proto__":{"polluted":true}}').expect(400);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it.each([
      ['an array', '[]'],
      ['a bare string', '"x"'],
    ])('rejects %s as the body', async (_label, body) => {
      await postRaw(JSON_TYPE, body).expect(400);
    });
  });

  describe('errors', () => {
    it('answers unknown routes in the API error format', async () => {
      const { body } = await api(app).get('/api/noway').expect(404);
      expect(body).toEqual({
        error: { code: 'NOT_FOUND', message: expect.any(String) },
      });
    });
  });

  describe('CORS', () => {
    const preflight = (origin: string, method: string) =>
      api(app)
        .options(FOLDERS)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', method)
        .set('Access-Control-Request-Headers', 'content-type');

    it('allows the configured origin to send JSON', async () => {
      const { headers } = await preflight(ALLOWED_ORIGIN, 'POST').expect(204);

      expect(headers[ALLOW_ORIGIN]).toBe(ALLOWED_ORIGIN);
      expect(headers['access-control-allow-methods']).toBe('GET,POST,DELETE');
      expect(headers['access-control-allow-headers']).toBe('Content-Type');
      expect(headers).not.toHaveProperty('access-control-allow-credentials');
    });

    it('gives another origin no permission', async () => {
      const { headers } = await preflight('http://evil.example', 'POST');
      expect(headers).not.toHaveProperty(ALLOW_ORIGIN);
    });

    it.each([
      'http://localhost:3001.evil.example',
      'http://localhost:30011',
      'https://localhost:3001',
      'null',
    ])('does not mistake %s for the configured origin', async (origin) => {
      const { headers } = await api(app).get(LIST).set('Origin', origin).expect(200);
      expect(headers).not.toHaveProperty(ALLOW_ORIGIN);
    });

    it('still serves clients that send no Origin', async () => {
      await api(app).get(LIST).expect(200);
    });

    it.each([
      ['400', () => api(app).post(FOLDERS).send({ name: '' }), 400],
      ['404', () => api(app).delete(`${FOLDERS}/${UNKNOWN_ID}`), 404],
      ['413', () => api(app).post(FOLDERS).send({ name: 'a'.repeat(5_000) }), 413],
      ['415', () => postRaw('text/plain', 'x'), 415],
    ])('lets the frontend read a %s', async (_label, send, status) => {
      const { headers } = await send().set('Origin', ALLOWED_ORIGIN).expect(status);
      
      expect(headers[ALLOW_ORIGIN]).toBe(ALLOWED_ORIGIN);
    });
  });
});
