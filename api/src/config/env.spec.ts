import { validateEnv } from './env.js';

const validEnv = {
  DATABASE_URL: 'postgres://user:secret@localhost:5432/db',
  CORS_ORIGINS: 'http://localhost:3001',
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    expect(validateEnv(validEnv)).toMatchObject({ PORT: 3000, DB_POOL_MAX: 10 });
  });

  it('coerces numbers from strings', () => {
    expect(validateEnv({ ...validEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it.each(['DATABASE_URL', 'CORS_ORIGINS'])('requires %s', (name) => {
    const { [name as keyof typeof validEnv]: _removed, ...incomplete } = validEnv;
    expect(() => validateEnv(incomplete)).toThrow(name);
  });

  it('never prints the value of an invalid variable', () => {
    const attempt = () => validateEnv({ ...validEnv, DATABASE_URL: 'mysql://user:hunter2@host/db' });

    expect(attempt).toThrow('DATABASE_URL');
    expect(attempt).not.toThrow('hunter2');
  });

  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['PORT', 'http'],
    ['DB_POOL_MAX', '0'],
    ['DB_STATEMENT_TIMEOUT_MS', '50'],
    ['RATE_LIMIT_WINDOW_MS', '999'],
    ['RATE_LIMIT_MAX', '0'],
    ['NODE_ENV', 'staging'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => validateEnv({ ...validEnv, [name]: value })).toThrow(name);
  });

  describe('CORS_ORIGINS', () => {
    it('splits a list and trims spaces', () => {
      const { CORS_ORIGINS } = validateEnv({
        ...validEnv,
        CORS_ORIGINS: 'http://localhost:3001, https://app.example.com',
      });

      expect(CORS_ORIGINS).toEqual(['http://localhost:3001', 'https://app.example.com']);
    });

    it.each([
      ['empty', ''],
      ['a wildcard', '*'],
      ['a wildcard among valid origins', 'http://localhost:3001,*'],
      ['missing a scheme', 'localhost:3001'],
      ['ending in a slash', 'http://localhost:3001/'],
      ['carrying a path', 'http://localhost:3001/app'],
      ['a trailing comma', 'http://localhost:3001,'],
    ])('rejects a value that is %s', (_label, value) => {
      expect(() => validateEnv({ ...validEnv, CORS_ORIGINS: value })).toThrow('CORS_ORIGINS');
    });
  });
});
