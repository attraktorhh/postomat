import './env-load.server';
import * as client from 'openid-client';
import { redirect } from 'react-router';
import { loadEnv } from '@postomat/core';
import { getSession, sessionStorage, type SessionUser } from './session.server';
import { rolesFromGroups, type Role } from './roles';
import { isSameOriginRequest, safeReturnTo } from './guards';

const env = loadEnv();
export const GROUPS = {
  mitglieder: env.GROUP_MITGLIEDER,
  medienteam: env.GROUP_MEDIENTEAM,
  admin: env.GROUP_ADMIN,
};

let configPromise: Promise<client.Configuration> | undefined;
function oidcConfig(): Promise<client.Configuration> {
  configPromise ??= client
    .discovery(
      new URL(env.OIDC_ISSUER),
      env.OIDC_CLIENT_ID,
      env.OIDC_CLIENT_SECRET,
      undefined,
      // The local Keycloak runs on plain http; production uses https.
      env.OIDC_ISSUER.startsWith('http://')
        ? { execute: [client.allowInsecureRequests] }
        : undefined,
    )
    .catch((e) => {
      configPromise = undefined;
      throw e;
    });
  return configPromise;
}

const callbackUrl = () =>
  `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/auth/callback`;

/** Starts the authorization code flow with PKCE. */
export async function startLogin(
  request: Request,
  returnTo = '/',
): Promise<Response> {
  const config = await oidcConfig();
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl(),
    scope: 'openid profile email',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  });
  const session = await getSession(request);
  session.set('oidc', {
    state,
    verifier,
    returnTo: safeReturnTo(returnTo),
  });
  return redirect(url.href, {
    headers: { 'set-cookie': await sessionStorage.commitSession(session) },
  });
}

export async function finishLogin(request: Request): Promise<Response> {
  const session = await getSession(request);
  const pending = session.get('oidc');
  if (!pending) return redirect('/');
  const config = await oidcConfig();
  const current = new URL(request.url);
  const external = new URL(`${callbackUrl()}${current.search}`);
  const tokens = await client.authorizationCodeGrant(config, external, {
    pkceCodeVerifier: pending.verifier,
    expectedState: pending.state,
  });
  const claims: Record<string, unknown> = tokens.claims() ?? {};
  let info: Record<string, unknown> = claims;
  if (!claims[env.OIDC_GROUPS_CLAIM] || !claims[env.OIDC_USERNAME_CLAIM]) {
    info = {
      ...claims,
      ...(await client.fetchUserInfo(
        config,
        tokens.access_token,
        claims.sub as string,
      )),
    };
  }
  const username = String(info[env.OIDC_USERNAME_CLAIM] ?? '');
  const groups = Array.isArray(info[env.OIDC_GROUPS_CLAIM])
    ? (info[env.OIDC_GROUPS_CLAIM] as string[])
    : [];
  const user: SessionUser = {
    username,
    name: typeof info['name'] === 'string' ? info['name'] : undefined,
    groups,
  };
  // New session id after login (no session fixation): drop the old row and
  // start a fresh session that only holds the user.
  await sessionStorage.destroySession(session);
  const fresh = await sessionStorage.getSession();
  fresh.set('user', user);
  if (tokens.id_token) fresh.set('idToken', tokens.id_token);
  return redirect(safeReturnTo(pending.returnTo), {
    headers: { 'set-cookie': await sessionStorage.commitSession(fresh) },
  });
}

export async function logout(request: Request): Promise<Response> {
  assertSameOrigin(request);
  const session = await getSession(request);
  const idToken = session.get('idToken');
  const headers = {
    'set-cookie': await sessionStorage.destroySession(session),
  };
  try {
    const config = await oidcConfig();
    const url = client.buildEndSessionUrl(config, {
      post_logout_redirect_uri: env.PUBLIC_WEB_URL,
      ...(idToken ? { id_token_hint: idToken } : {}),
    });
    return redirect(url.href, { headers });
  } catch {
    return redirect('/', { headers });
  }
}

export interface CurrentUser extends SessionUser {
  roles: Role[];
}

export async function getUser(request: Request): Promise<CurrentUser | null> {
  const session = await getSession(request);
  const user = session.get('user');
  if (!user) return null;
  return { ...user, roles: rolesFromGroups(user.groups, GROUPS) };
}

/** Rejects cross-site state-changing requests (CSRF) with 403. */
export function assertSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request, env.PUBLIC_WEB_URL))
    throw new Response('Anfrage von einer fremden Seite abgelehnt.', {
      status: 403,
    });
}

/** 403 body when the user has a Postomat group but not the needed role. */
export function roleMissingText(roles: Role[]): string {
  return roles.includes('medienteam')
    ? 'Diese Seite ist nur fürs Medienteam.'
    : roles.includes('admin')
      ? 'Diese Seite ist nur für Postomat-Admins.'
      : 'Kein Zugang';
}

export const NOT_YOUR_POST =
  'Das ist nicht dein Beitrag. Deine Beiträge findest du unter „Meine Beiträge“.';

/**
 * Requires a logged-in user with one of the roles. Not logged in → login,
 * logged in without any Postomat group (or without the role) → "Kein Zugang".
 * Non-GET requests must come from this site (CSRF guard).
 */
export async function requireUser(
  request: Request,
  roles?: Role[],
): Promise<CurrentUser> {
  assertSameOrigin(request);
  const user = await getUser(request);
  if (!user) {
    const url = new URL(request.url);
    throw redirect(
      `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
    );
  }
  if (!user.roles.length) throw new Response('Kein Zugang', { status: 403 });
  if (roles && !roles.some((r) => user.roles.includes(r)))
    throw new Response(roleMissingText(roles), { status: 403 });
  return user;
}
