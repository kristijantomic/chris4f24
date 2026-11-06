import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env.js';

export const PG_POOL = Symbol('PG_POOL');

function createPool(config: ConfigService<Env, true>): Pool {
  const pool = new Pool({
    connectionString: config.get('DATABASE_URL', { infer: true }),
    max: config.get('DB_POOL_MAX', { infer: true }),
    statement_timeout: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });

  const logger = new Logger('DatabasePool');
  
  pool.on('error', (err) => logger.error(`Idle client error: ${err.message}`));

  return pool;
}

@Global()
@Module({
  providers: [{ provide: PG_POOL, inject: [ConfigService], useFactory: createPool }],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
