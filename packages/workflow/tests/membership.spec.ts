import { describe, expect, it } from 'vitest';
import type { MatrixPort } from '@postomat/core';
import { Membership } from '../src/membership.ts';

function setup() {
  let now = 0;
  let fail = false;
  const rooms: Record<string, string[]> = {
    '!m:localhost': ['@postomat:localhost', '@lena:localhost', '@x:elsewhere'],
    '!t:localhost': ['@postomat:localhost', '@kai:localhost'],
  };
  const matrix = {
    userId: '@postomat:localhost',
    resolveRoom: async (r: string) => r,
    getJoinedMembers: async (roomId: string) => {
      if (fail) throw new Error('502 Bad Gateway');
      return rooms[roomId] ?? [];
    },
  } as unknown as MatrixPort;
  // No settings row → env seeds the rooms.
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  };
  const deps = {
    db,
    env: {
      MATRIX_MEMBER_ROOMS: '!m:localhost',
      MATRIX_MEDIENTEAM_ROOM: '!t:localhost',
      MATRIX_MEMBERSHIP_CACHE_SEC: 300,
    },
    now: () => new Date(now),
  } as unknown as ConstructorParameters<typeof Membership>[0];
  const m = new Membership(deps, matrix);
  return {
    m,
    rooms,
    advance: (ms: number) => (now += ms),
    setFail: (v: boolean) => (fail = v),
  };
}

describe('Membership', () => {
  it('counts only local users, never the bot', async () => {
    const { m } = setup();
    expect(await m.isMember('@lena:localhost')).toBe(true);
    expect(await m.isMember('@x:elsewhere')).toBe(false);
    expect(await m.isMember('@postomat:localhost')).toBe(false);
    expect(await m.isMedienteam('@kai:localhost')).toBe(true);
  });

  it('keeps the expired result during a homeserver hiccup and retries next time', async () => {
    const { m, rooms, advance, setFail } = setup();
    expect(await m.isMedienteam('@kai:localhost')).toBe(true);
    advance(301_000);
    setFail(true);
    expect(await m.isMedienteam('@kai:localhost')).toBe(true);
    setFail(false);
    rooms['!t:localhost'] = ['@postomat:localhost', '@mira:localhost'];
    expect(await m.isMedienteam('@mira:localhost')).toBe(true);
  });

  it('rethrows when there is no earlier result', async () => {
    const { m, setFail } = setup();
    setFail(true);
    await expect(m.isMember('@lena:localhost')).rejects.toThrow('502');
  });
});
