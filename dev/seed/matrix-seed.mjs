// Idempotent Matrix seed for the local Synapse. Dependency-free (Node 24, global fetch).
//
// - registers users via the shared-secret admin API (/_synapse/admin/v1/register)
// - creates the encrypted rooms #mitglieder:localhost and #medienteam:localhost
// - invites + joins the members (each user logs in with device "SEED", joins, logs out)
//
// Never touches the bot's real device POSTOMATDEV.

import { createHmac } from 'node:crypto';

const HS = (process.env.SYNAPSE_URL ?? 'http://localhost:8008').replace(/\/$/, '');
const SHARED_SECRET = process.env.REGISTRATION_SHARED_SECRET ?? 'postomat-dev-registration-secret';
const SERVER = process.env.SERVER_NAME ?? 'localhost';
const SEED_DEVICE = 'SEED';

const USERS = [
  { localpart: 'admin', password: 'postomat-dev', admin: true, displayname: 'Admin' },
  { localpart: 'postomat', password: 'postomat-bot-dev', admin: false, displayname: 'Postomat' },
  { localpart: 'lena', password: 'postomat-dev', admin: false, displayname: 'Lena' },
  { localpart: 'kai', password: 'postomat-dev', admin: false, displayname: 'Kai' },
  { localpart: 'mira', password: 'postomat-dev', admin: false, displayname: 'Mira' },
  { localpart: 'gast', password: 'postomat-dev', admin: false, displayname: 'Gast' },
];
const pw = Object.fromEntries(USERS.map((u) => [u.localpart, u.password]));

const ROOMS = [
  { alias: 'mitglieder', name: 'Attraktor Mitglieder', creator: 'lena', members: ['lena', 'kai', 'mira', 'postomat'] },
  { alias: 'medienteam', name: 'Medienteam', creator: 'kai', members: ['kai', 'mira', 'postomat'] },
];

const mxid = (localpart) => `@${localpart}:${SERVER}`;

async function api(method, path, { token, body, ok = [] } = {}) {
  const res = await fetch(`${HS}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && !ok.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return { status: res.status, json };
}

async function waitForSynapse() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${HS}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Synapse at ${HS} not healthy`);
}

async function registerUser({ localpart, password, admin, displayname }) {
  const { json: nonceRes } = await api('GET', '/_synapse/admin/v1/register');
  const mac = createHmac('sha1', SHARED_SECRET)
    .update(`${nonceRes.nonce}\0${localpart}\0${password}\0${admin ? 'admin' : 'notadmin'}`)
    .digest('hex');
  const { status, json } = await api('POST', '/_synapse/admin/v1/register', {
    body: { nonce: nonceRes.nonce, username: localpart, displayname, password, admin, mac },
    ok: [400],
  });
  if (status === 400) {
    if (json.errcode !== 'M_USER_IN_USE') throw new Error(`register ${localpart}: ${JSON.stringify(json)}`);
    console.log(`user ${mxid(localpart)} exists`);
  } else {
    // The register API logs the new user in; drop that session/device again.
    if (json.access_token) await api('POST', '/_matrix/client/v3/logout', { token: json.access_token, ok: [401] });
    console.log(`user ${mxid(localpart)} created`);
  }
}

async function withSession(localpart, fn) {
  const { json } = await api('POST', '/_matrix/client/v3/login', {
    body: {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: localpart },
      password: pw[localpart],
      device_id: SEED_DEVICE,
      initial_device_display_name: 'dev seed (throwaway)',
    },
  });
  try {
    return await fn(json.access_token);
  } finally {
    await api('POST', '/_matrix/client/v3/logout', { token: json.access_token, ok: [401] });
  }
}

async function resolveAlias(alias) {
  const { status, json } = await api('GET', `/_matrix/client/v3/directory/room/${encodeURIComponent(`#${alias}:${SERVER}`)}`, {
    ok: [404],
  });
  return status === 404 ? null : json.room_id;
}

async function membership(token, roomId, localpart) {
  const { status, json } = await api(
    'GET',
    `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(mxid(localpart))}`,
    { token, ok: [404] },
  );
  return status === 404 ? null : json.membership;
}

async function ensureRoom(room) {
  let roomId = await resolveAlias(room.alias);
  await withSession(room.creator, async (token) => {
    if (!roomId) {
      const { json } = await api('POST', '/_matrix/client/v3/createRoom', {
        token,
        body: {
          name: room.name,
          room_alias_name: room.alias,
          preset: 'private_chat',
          visibility: 'private',
          initial_state: [
            { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
          ],
        },
      });
      roomId = json.room_id;
      console.log(`room #${room.alias}:${SERVER} created: ${roomId}`);
    } else {
      console.log(`room #${room.alias}:${SERVER} exists: ${roomId}`);
    }
    for (const member of room.members) {
      if (member === room.creator) continue;
      const m = await membership(token, roomId, member);
      if (m === 'join' || m === 'invite') continue;
      await api('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, {
        token,
        body: { user_id: mxid(member) },
      });
      console.log(`  invited ${mxid(member)}`);
    }
  });
  for (const member of room.members) {
    if (member === room.creator) continue;
    const already = await withSession(room.creator, (t) => membership(t, roomId, member));
    if (already === 'join') continue;
    await withSession(member, (token) =>
      api('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, { token, body: {} }),
    );
    console.log(`  ${mxid(member)} joined`);
  }
  return roomId;
}

await waitForSynapse();
for (const user of USERS) await registerUser(user);
const result = {};
for (const room of ROOMS) result[`#${room.alias}:${SERVER}`] = await ensureRoom(room);

console.log('\nMatrix seed done. Rooms:');
for (const [alias, id] of Object.entries(result)) console.log(`  ${alias.padEnd(24)} ${id}`);
