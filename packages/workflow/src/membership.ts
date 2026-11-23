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
 * Membership from the bot's room state: a member is joined to at least one
 * configured "Mitglieder" room, Medienteam is joined to the Medienteam room.
 * Results are cached for MATRIX_MEMBERSHIP_CACHE_SEC (max. 5 minutes).
 */
export class Membership {
  private cache?: {
    at: number;
    members: Set<string>;
    medienteam: Set<string>;
    medienteamRoomId?: string;
    memberRoomIds: string[];
  };
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

  private async load() {
    const ttl = this.deps.env.MATRIX_MEMBERSHIP_CACHE_SEC * 1000;
    if (this.cache && this.deps.now().getTime() - this.cache.at < ttl)
      return this.cache;
    const cfg = await getRoomSettings(this.deps);
    const memberRoomIds: string[] = [];
    const members = new Set<string>();
    for (const r of cfg.memberRooms) {
      const id = await this.matrix.resolveRoom(r).catch(() => undefined);
      if (!id) continue;
      memberRoomIds.push(id);
      for (const m of await this.matrix.getJoinedMembers(id).catch(() => []))
        members.add(m);
    }
    const medienteamRoomId = cfg.medienteamRoom
      ? await this.matrix.resolveRoom(cfg.medienteamRoom).catch(() => undefined)
      : undefined;
    const medienteam = new Set(
      medienteamRoomId
        ? await this.matrix.getJoinedMembers(medienteamRoomId).catch(() => [])
        : [],
    );
    members.delete(this.matrix.userId);
    medienteam.delete(this.matrix.userId);
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
