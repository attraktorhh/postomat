import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MatrixClient } from 'matrix-bot-sdk';
import type { Env } from '@postomat/core';

export interface BotSession {
  userId: string;
  deviceId: string;
  accessToken: string;
}

const file = (env: Env) => join(env.MATRIX_DATA_DIR, 'session.json');

/** The token's user and device, or null when the homeserver rejects it. */
async function whoami(
  env: Env,
  token: string,
): Promise<{ user_id: string; device_id?: string } | null> {
  try {
    return await new MatrixClient(env.MATRIX_HOMESERVER_URL, token).getWhoAmI();
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode === 401) return null;
    throw e;
  }
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
  // matrix-bot-sdk's MatrixAuth.passwordLogin cannot pass a device_id, which
  // the stable E2EE device needs: same request through the SDK's client.
  const body = (await new MatrixClient(env.MATRIX_HOMESERVER_URL, '').doRequest(
    'POST',
    '/_matrix/client/v3/login',
    null,
    {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: env.MATRIX_USERNAME },
      password: env.MATRIX_PASSWORD,
      device_id: env.MATRIX_DEVICE_ID,
      initial_device_display_name: 'Postomat',
    },
  )) as { user_id: string; device_id: string; access_token: string };
  const session: BotSession = {
    userId: body.user_id,
    deviceId: body.device_id,
    accessToken: body.access_token,
  };
  await writeFile(file(env), JSON.stringify(session), { mode: 0o600 });
  return session;
}
