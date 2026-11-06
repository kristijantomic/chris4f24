import { DatabaseError } from 'pg';
import { isDatabaseUnavailable } from './pg-errors.js';

function databaseError(code: string): DatabaseError {
  const error = new DatabaseError('failed', 0, 'error');
  error.code = code;
  return error;
}

const connectionError = (code: string): Error => Object.assign(new Error('failed'), { code });

describe('isDatabaseUnavailable', () => {
  it.each([
    ['statement timeout', '57014'],
    ['deadlock', '40P01'],
    ['serialization failure', '40001'],
    ['too many connections', '53300'],
    ['server shutting down', '57P01'],
    ['connection exception class', '08006'],
  ])('is true for a %s', (_label, code) => {
    expect(isDatabaseUnavailable(databaseError(code))).toBe(true);
  });

  it.each([
    ['a syntax error', '42601'],
    ['missing privileges', '42501'],
    ['a constraint violation', '23505'],
  ])('is false for %s, which is a bug and must not look temporary', (_label, code) => {
    expect(isDatabaseUnavailable(databaseError(code))).toBe(false);
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE'])('is true for %s', (code) => {
    expect(isDatabaseUnavailable(connectionError(code))).toBe(true);
  });

  it('is true for an AggregateError, as raised when localhost refuses on IPv4 and IPv6', () => {
    const error = Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' });
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it.each(['timeout exceeded when trying to connect', 'Connection terminated unexpectedly'])(
    'is true for the driver message "%s"',
    (message) => {
      expect(isDatabaseUnavailable(new Error(message))).toBe(true);
    },
  );

  it.each([
    ['an ordinary error', new Error('boom')],
    ['a string', 'ECONNREFUSED'],
    ['null', null],
  ])('is false for %s', (_label, value) => {
    expect(isDatabaseUnavailable(value)).toBe(false);
  });
});
