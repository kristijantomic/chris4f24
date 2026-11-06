import { readFile } from 'node:fs/promises';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

const POSTGRES_IMAGE = 'postgres:18';
const APP_ROLE = 'app_user';
const APP_ROLE_PASSWORD = 'test_only';

declare global {
  var postgresContainer: StartedPostgreSqlContainer | undefined;
}

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();

  globalThis.postgresContainer = container;

  const superuserUrl = container.getConnectionUri();
  const superuser = new pg.Client({ connectionString: superuserUrl });

  await superuser.connect();
  await superuser.query(await readFile('../postgres/db/2-schema.sql', 'utf8'));
  await superuser.query(`
    CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}';
    GRANT SELECT, INSERT, DELETE ON nodes TO ${APP_ROLE};
  `);
  await superuser.end();

  const appUrl = new URL(superuserUrl);

  appUrl.username = APP_ROLE;
  appUrl.password = APP_ROLE_PASSWORD;
  
  process.env['DATABASE_URL'] = appUrl.href;
}
