import './env-load.server';
import { randomUUID } from 'node:crypto';
import { createCookie, createSessionStorage } from 'react-router';
import { eq, sessions } from '@postomat/db';
import { loadEnv, productionSecretProblems } from '@postomat/core';
import { getDeps } from './deps.server';

export interface SessionUser {
  username: string;
  name?: string;
  groups: string[];
}

export interface SessionData {
  user?: SessionUser;
  /** OIDC login state */
  oidc?: { state: string; verifier: string; returnTo: string };
  idToken?: string;
}

const env = loadEnv();
const secretProblems = productionSecretProblems(env);
if (secretProblems.length)
  throw new Error(`Refusing to start: ${secretProblems.join('; ')}`);
const MAX_AGE = 60 * 60 * 12;

const cookie = createCookie('postomat_session', {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: env.PUBLIC_WEB_URL.startsWith('https://'),
  secrets: [env.SESSION_SECRET],
  maxAge: MAX_AGE,
});

/** Server-side sessions in Postgres; the cookie only holds the signed session id. */
export const sessionStorage = createSessionStorage<SessionData>({
  cookie,
  async createData(data, expires) {
    const { db } = await getDeps();
    const id = randomUUID();
    await db.insert(sessions).values({
      id,
      data: data as Record<string, unknown>,
      expiresAt: expires ?? new Date(Date.now() + MAX_AGE * 1000),
    });
    return id;
  },
  async readData(id) {
    const { db } = await getDeps();
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
    if (!row || row.expiresAt < new Date()) return null;
    return row.data as SessionData;
  },
  async updateData(id, data, expires) {
    const { db } = await getDeps();
    await db
      .insert(sessions)
      .values({
        id,
        data: data as Record<string, unknown>,
        expiresAt: expires ?? new Date(Date.now() + MAX_AGE * 1000),
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          data: data as Record<string, unknown>,
          expiresAt: expires ?? new Date(Date.now() + MAX_AGE * 1000),
        },
      });
  },
  async deleteData(id) {
    const { db } = await getDeps();
    await db.delete(sessions).where(eq(sessions.id, id));
  },
});

export const getSession = (request: Request) =>
  sessionStorage.getSession(request.headers.get('cookie'));
