import { z } from 'zod';

const coreSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(1, 'TOKEN_ENCRYPTION_KEY is required (base64, 32 bytes — generate with `openssl rand -base64 32`)'),
  SESSION_JWT_SECRET: z.string().min(1, 'SESSION_JWT_SECRET is required (generate with `openssl rand -base64 32`)'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_APP_URL: z.string().url('PUBLIC_APP_URL must be a full URL, e.g. http://localhost:3000'),
});

/// Fails fast at boot: without these, nothing in the app can work (no DB, no
/// sessions, no token encryption), so there's no useful degraded mode.
const core = coreSchema.parse(process.env);

/// Provider credentials are intentionally NOT required at boot — the server
/// should still come up (and serve the app / non-OAuth routes) if these are
/// unset, e.g. right after `docker compose up` before the operator has
/// registered the OAuth apps. Missing credentials only fail the specific
/// /auth/:provider/start route, with a clear message (see providers/*.ts).
export const env = {
  ...core,
  ASANA_CLIENT_ID: process.env.ASANA_CLIENT_ID || null,
  ASANA_CLIENT_SECRET: process.env.ASANA_CLIENT_SECRET || null,
  MS_CLIENT_ID: process.env.MS_CLIENT_ID || null,
  MS_CLIENT_SECRET: process.env.MS_CLIENT_SECRET || null,
  MS_TENANT_ID: process.env.MS_TENANT_ID || 'common',
  // Where the change-log workbook lives. Unset by default (changeLog.ts
  // falls back to the repo root) — Docker overrides this to a mounted
  // volume path, since the container's own filesystem isn't visible on
  // the host. See changeLog.ts and docker-compose.yml.
  CHANGE_LOG_PATH: process.env.CHANGE_LOG_PATH || null,
};
