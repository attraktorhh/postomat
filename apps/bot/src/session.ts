import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '@postomat/core';

export interface BotSession {
  userId: string;
  deviceId: string;
  accessToken: string;
}

const file = (env: Env) => join(env.MATRIX_DATA_DIR, 'session.json');

async function whoami(
  env: Env,
  token: string,
): Promise<{ user_id: string; device_id?: string } | null> {
  const res = await fetch(
    `${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/account/whoami`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`whoami failed: HTTP ${res.status}`);
  return (await res.json()) as { user_id: string; device_id?: string };
}

/**
 * Returns a valid session. Prefers MATRIX_ACCESS_TOKEN; otherwise logs in with
 * MATRIX_USERNAME/MATRIX_PASSWORD using the stable MATRIX_DEVICE_ID, so the
 * E2EE device (and its crypto store) survives restarts and re-logins.
 */
export async function obtainSession(env: Env): Promise<BotSession> {
  await mkdir(env.MATRIX_DATA_DIR, { recursive: true });
  if (env.MATRIX_ACCESS_TOKEN) {
    const me = await whoami(env, env.MATRIX_ACCESS_TOKEN);
    if (!me) throw new Error('MATRIX_ACCESS_TOKEN is not valid');
    return {
      userId: me.user_id,
      deviceId: me.device_id ?? env.MATRIX_DEVICE_ID,
      accessToken: env.MATRIX_ACCESS_TOKEN,
    };
  }
  try {
    const saved = JSON.parse(await readFile(file(env), 'utf8')) as BotSession;
    const me = await whoami(env, saved.accessToken);
    if (me && me.device_id === env.MATRIX_DEVICE_ID) return saved;
  } catch {
    /* no saved session */
  }
  if (!env.MATRIX_USERNAME || !env.MATRIX_PASSWORD) {
    throw new Error(
      'Set MATRIX_ACCESS_TOKEN or MATRIX_USERNAME + MATRIX_PASSWORD',
    );
  }
  const res = await fetch(
    `${env.MATRIX_HOMESERVER_URL}/_matrix/client/v3/login`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: env.MATRIX_USERNAME },
        password: env.MATRIX_PASSWORD,
        device_id: env.MATRIX_DEVICE_ID,
        initial_device_display_name: 'Postomat',
      }),
    },
  );
  if (!res.ok)
    throw new Error(
      `Matrix login failed: HTTP ${res.status} ${await res.text()}`,
    );
  const body = (await res.json()) as {
    user_id: string;
    device_id: string;
    access_token: string;
  };
  const session: BotSession = {
    userId: body.user_id,
    deviceId: body.device_id,
    accessToken: body.access_token,
  };
  await writeFile(file(env), JSON.stringify(session), { mode: 0o600 });
  return session;
}
