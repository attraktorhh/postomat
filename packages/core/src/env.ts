import { z } from 'zod';

/**
 * Environment shared by bot, web and worker. Defaults point at the local docker
 * compose stack; nothing here ever defaults to a real Attraktor service.
 */
const optional = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v.trim() === '' ? undefined : v.trim(),
  );
const int = (def: number) => z.coerce.number().int().positive().default(def);

export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z
    .string()
    .default('postgres://postomat:postomat@localhost:55432/postomat'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),
  POSTOMAT_CONFIG: optional,

  MATRIX_HOMESERVER_URL: z.string().default('http://localhost:8008'),
  MATRIX_ACCESS_TOKEN: optional,
  MATRIX_USERNAME: optional,
  MATRIX_PASSWORD: optional,
  MATRIX_DEVICE_ID: z.string().default('POSTOMATDEV'),
  MATRIX_DATA_DIR: z.string().default('./.data/matrix'),
  MATRIX_MEMBER_ROOMS: optional,
  MATRIX_MEDIENTEAM_ROOM: optional,
  MATRIX_MEMBERSHIP_CACHE_SEC: z.coerce
    .number()
    .int()
    .min(0)
    .max(300)
    .default(300),

  OIDC_ISSUER: z.string().default('http://localhost:8180/realms/attraktor'),
  OIDC_CLIENT_ID: z.string().default('postomat'),
  OIDC_CLIENT_SECRET: optional,
  OIDC_USERNAME_CLAIM: z.string().default('preferred_username'),
  OIDC_GROUPS_CLAIM: z.string().default('groups'),
  GROUP_MITGLIEDER: z.string().default('mitglieder'),
  GROUP_MEDIENTEAM: z.string().default('medienteam'),
  GROUP_ADMIN: z.string().default('postomat-admin'),
  /** Dev default only; the web refuses to start with it in production. */
  SESSION_SECRET: z.string().default('dev-only-session-secret-change-me'),

  /** AI SDK provider package; AI is required for bot and worker. */
  AI_PROVIDER: z
    .enum(['openai-compatible', 'openai', 'anthropic', 'deepseek'])
    .default('openai-compatible'),
  /** Required for openai-compatible; optional override for the others. */
  AI_BASE_URL: optional,
  AI_API_KEY: optional,
  AI_MODEL: optional,
  /**
   * openai-compatible only: `json_schema` (strict structured output) or
   * `json` (JSON mode, the schema goes into the prompt) for endpoints that
   * only accept `json_object`. The other providers pick their own mode.
   */
  AI_STRUCTURED_OUTPUT: z.enum(['json_schema', 'json']).default('json_schema'),
  /** AI SDK reasoning level (`none` = thinking off); unset = provider default. */
  AI_REASONING: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .enum([
        'provider-default',
        'none',
        'minimal',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ])
      .optional(),
  ),
  AI_TIMEOUT_MS: int(20000),
  /** How long bot and worker wait for the AI endpoint at startup. */
  AI_STARTUP_TIMEOUT_MS: int(120000),

  WORDPRESS_URL: z.string().default('http://localhost:8081'),
  WORDPRESS_USERNAME: optional,
  WORDPRESS_APP_PASSWORD: optional,
  WORDPRESS_POST_STATUS: z.enum(['publish', 'draft']).default('publish'),

  MEDIAWIKI_API_URL: z.string().default('http://localhost:8082/api.php'),
  MEDIAWIKI_PAGE_BASE_URL: z
    .string()
    .default('http://localhost:8082/index.php/'),
  MEDIAWIKI_BOT_USERNAME: optional,
  MEDIAWIKI_BOT_PASSWORD: optional,

  NEXTCLOUD_WEBDAV_URL: z
    .string()
    .default('http://localhost:8083/remote.php/dav/files/postomat'),
  NEXTCLOUD_USERNAME: optional,
  NEXTCLOUD_PASSWORD: optional,
  NEXTCLOUD_BASE_FOLDER: z.string().default('/Postomat-Fotos'),
  /** Used instead of Nextcloud when NEXTCLOUD_USERNAME/PASSWORD are empty (dev only). */
  MEDIA_LOCAL_DIR: z.string().default('./.data/media'),

  MEETUP_ICAL_URL: z
    .string()
    .default('http://localhost:8084/attraktor/events/ical/'),
  MEETUP_GROUP_URL: z.string().default('http://localhost:8084/attraktor/'),
  MEETUP_POLL_INTERVAL_MIN: int(10),

  DEFAULT_EVENT_DURATION_MIN: int(180),
  BANNER_LOGO_PATH: optional,
  BANNER_TITLE_FONT_PATH: optional,
  JOB_RETRY_LIMIT: z.coerce.number().int().min(0).default(3),

  PORT: int(3000),
  BOT_HEALTH_PORT: int(3001),
  WORKER_HEALTH_PORT: int(3002),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(source);
}

/** Dev defaults that must never reach production (see .env.example). */
const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me';
const DEV_OIDC_SECRET = 'postomat-dev-secret';

/**
 * Web-only startup check: with NODE_ENV=production the session secret and the
 * OIDC client secret must be real values, not the dev defaults. Returns the
 * problems (empty when fine), so the caller decides whether to throw.
 */
export function productionSecretProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  if (
    env.SESSION_SECRET === DEV_SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  )
    problems.push(
      'SESSION_SECRET must be a random value of at least 32 characters',
    );
  if (!env.OIDC_CLIENT_SECRET || env.OIDC_CLIENT_SECRET === DEV_OIDC_SECRET)
    problems.push('OIDC_CLIENT_SECRET must be the real Keycloak client secret');
  return problems;
}

/** Splits a comma separated env list. */
export const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
