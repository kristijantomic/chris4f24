import { z } from 'zod';

// An exact origin only, so a wildcard or a stray path or trailing slash fails at
// startup instead of silently blocking the frontend.
const corsOrigin = z
  .string()
  .refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    'must be exact origins such as http://localhost:3001',
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  CORS_ORIGINS: z
    .string()
    .transform((value) => value.split(',').map((origin) => origin.trim()))
    .pipe(z.array(corsOrigin)),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  // Report variable names and reasons only: values can contain credentials.
  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
    
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
