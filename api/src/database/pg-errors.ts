import { DatabaseError } from 'pg';

const UNAVAILABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '53300', // too_many_connections
  '57014', // query_canceled (statement timeout)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
]);

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof DatabaseError) {
    const sqlState = error.code ?? '';

    return UNAVAILABLE_SQLSTATES.has(sqlState) || sqlState.startsWith('08');
  }

  if (!Error.isError(error)) return false;

  const { code } = error as NodeJS.ErrnoException;
  
  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) return true;

  return /timeout exceeded when trying to connect|connection terminated/i.test(error.message);
}
