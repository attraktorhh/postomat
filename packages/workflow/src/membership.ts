import { splitList, type MatrixPort } from '@postomat/core';
import { eq, settings } from '@postomat/db';
import type { WorkflowDeps } from './deps.ts';

export interface RoomSettings {
  memberRooms: string[];
  medienteamRoom: string | null;
}

const KEY = 'matrix_rooms';

/** Room settings from the DB, seeded from env when the DB has none. */
export async function getRoomSettings(
  deps: Pick<WorkflowDeps, 'db' | 'env'>,
): Promise<RoomSettings> {
  const [row] = await deps.db
    .select()
    .from(settings)
    .where(eq(settings.key, KEY));
  if (row) return row.value as RoomSettings;
  return {
    memberRooms: splitList(deps.env.MATRIX_MEMBER_ROOMS),
    medienteamRoom: deps.env.MATRIX_MEDIENTEAM_ROOM ?? null,
  };
}

export async function saveRoomSettings(
  deps: Pick<WorkflowDeps, 'db'>,
  value: RoomSettings,
  actor: string,
): Promise<void> {
  await deps.db
    .insert(settings)
    .values({ key: KEY, value, updatedBy: actor })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: actor, updatedAt: new Date() },
    });
}
/**
 * True for Matrix errors that will not go away on retry (room not found,
 * bot not in the room). Those count as "nobody" and may be cached; anything
 * else (network, 5xx, rate limit) is transient and must not be cached.
 */
export function isPermanentMatrixError(e: unknown): boolean {
  const err = e as { statusCode?: number; errcode?: string } | null;
  return (
    err?.statusCode === 403 ||
    err?.statusCode === 404 ||
    err?.errcode === 'M_FORBIDDEN' ||
    err?.errcode === 'M_NOT_FOUND'
  );
}

type MembershipCache = {
  at: number;
  members: Set<string>;
  medienteam: Set<string>;
  medienteamRoomId?: string;
  memberRoomIds: string[];
};

/**
 * Membership from the bot's room state: a member is joined to at least one
 * configured "Mitglieder" room, Medienteam is joined to the Medienteam room.
 * Only users on the bot's own homeserver count (a federated room must not let
 * `@lena:elsewhere` act as the club's `lena`).
 * Results are cached for MATRIX_MEMBERSHIP_CACHE_SEC (max. 5 minutes); a load
 * that hit a transient Matrix error is not cached but rethrown.
 */
export class Membership {
  private cache?: MembershipCache;
  private loading?: Promise<MembershipCache>;
  private readonly deps: Pick<WorkflowDeps, 'db' | 'env' | 'now'>;
  private readonly matrix: MatrixPort;

  constructor(
    deps: Pick<WorkflowDeps, 'db' | 'env' | 'now'>,
    matrix: MatrixPort,
  ) {
    this.deps = deps;
    this.matrix = matrix;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  private get serverName(): string {
    return this.matrix.userId.split(':').slice(1).join(':');
  }

  /** True when `userId` belongs to the bot's own homeserver. */
  isLocalUser(userId: string): boolean {
    return userId.split(':').slice(1).join(':') === this.serverName;
  }

  private async members(roomId: string): Promise<string[]> {
    try {
      return await this.matrix.getJoinedMembers(roomId);
    } catch (e) {
      if (isPermanentMatrixError(e)) return [];
      throw e;
    }
  }

  private async load(): Promise<MembershipCache> {
    const ttl = this.deps.env.MATRIX_MEMBERSHIP_CACHE_SEC * 1000;
    if (this.cache && this.deps.now().getTime() - this.cache.at < ttl)
      return this.cache;
    // Concurrent callers share one load.
    this.loading ??= this.fetch().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async fetch(): Promise<MembershipCache> {
    const cfg = await getRoomSettings(this.deps);
    const memberRoomIds: string[] = [];
    const members = new Set<string>();
    for (const r of cfg.memberRooms) {
      const id = await this.matrix.resolveRoom(r);
      if (!id) continue;
      memberRoomIds.push(id);
      for (const m of await this.members(id)) members.add(m);
    }
    const medienteamRoomId = cfg.medienteamRoom
      ? await this.matrix.resolveRoom(cfg.medienteamRoom)
      : undefined;
    const medienteam = new Set(
      medienteamRoomId ? await this.members(medienteamRoomId) : [],
    );
    for (const set of [members, medienteam]) {
      set.delete(this.matrix.userId);
      for (const m of set) if (!this.isLocalUser(m)) set.delete(m);
    }
    this.cache = {
      at: this.deps.now().getTime(),
      members,
      medienteam,
      medienteamRoomId,
      memberRoomIds,
    };
    return this.cache;
  }

  async isMember(userId: string): Promise<boolean> {
    return (await this.load()).members.has(userId);
  }

  async isMedienteam(userId: string): Promise<boolean> {
    return (await this.load()).medienteam.has(userId);
  }

  async medienteamRoomId(): Promise<string | undefined> {
    return (await this.load()).medienteamRoomId;
  }

  async configuredRoomIds(): Promise<string[]> {
    const c = await this.load();
    return [
      ...c.memberRoomIds,
      ...(c.medienteamRoomId ? [c.medienteamRoomId] : []),
    ];
  }
}
