import { join } from 'node:path';
import {
  LogLevel,
  LogService,
  MatrixClient,
  RustSdkCryptoStorageProvider,
  SimpleFsStorageProvider,
} from 'matrix-bot-sdk';
import type {
  Logger,
  MatrixImage,
  MatrixIncoming,
  MatrixMessageOptions,
  MatrixPort,
  MatrixRoomInfo,
} from '@postomat/core';
import type { BotSession } from './session.ts';

type RawEvent = { type: string; sender: string; event_id: string; content: Record<string, any>; state_key?: string };

/** MatrixPort implemented with matrix-bot-sdk and the Rust crypto store (E2EE). */
export class SdkMatrix implements MatrixPort {
  readonly client: MatrixClient;
  readonly userId: string;
  private readonly log: Logger;

  constructor(homeserverUrl: string, session: BotSession, dataDir: string, log: Logger) {
    LogService.setLevel(LogLevel.WARN);
    const storage = new SimpleFsStorageProvider(join(dataDir, 'sync.json'));
    const crypto = new RustSdkCryptoStorageProvider(join(dataDir, 'crypto'), 0 /* RustSdkCryptoStoreType.Sqlite (ambient const enum) */);
    this.client = new MatrixClient(homeserverUrl, session.accessToken, storage, crypto);
    this.userId = session.userId;
    this.log = log;
  }

  /** Starts syncing; `onEvent` receives normalised (decrypted) events. */
  async start(onEvent: (e: MatrixIncoming) => Promise<void>): Promise<void> {
    this.client.on('room.invite', (roomId: string, event: RawEvent) => {
      void onEvent({ kind: 'invite', roomId, sender: event.sender });
    });
    this.client.on('room.failed_decryption', (roomId: string, event: RawEvent, e: Error) => {
      this.log.warn('failed to decrypt event', { roomId, eventId: event.event_id, error: e?.message });
    });
    this.client.on('room.event', (roomId: string, event: RawEvent) => {
      const normalised = normalise(roomId, event);
      if (normalised) void onEvent(normalised);
    });
    await this.client.start();
    await this.replayPendingInvites(onEvent).catch((e: Error) => this.log.warn('could not check pending invites', { error: e.message }));
  }

  /**
   * Invites that arrived while the bot was down (or were ignored before the
   * room settings were right) are not re-sent by an incremental sync, so check
   * the invite list once on start.
   */
  private async replayPendingInvites(onEvent: (e: MatrixIncoming) => Promise<void>): Promise<void> {
    const filter = JSON.stringify({ room: { timeline: { limit: 1 }, state: { types: ['m.room.member'] } }, presence: { not_types: ['*'] } });
    const res = (await this.client.doRequest('GET', '/_matrix/client/v3/sync', { filter, timeout: 0 })) as {
      rooms?: { invite?: Record<string, { invite_state?: { events?: RawEvent[] } }> };
    };
    for (const [roomId, room] of Object.entries(res.rooms?.invite ?? {})) {
      const invite = room.invite_state?.events?.find((e) => e.type === 'm.room.member' && e.state_key === this.userId);
      if (invite) await onEvent({ kind: 'invite', roomId, sender: invite.sender });
    }
  }

  stop(): void {
    this.client.stop();
  }

  private relations(opts: MatrixMessageOptions): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    if (opts.threadRoot) {
      extra['m.relates_to'] = {
        rel_type: 'm.thread',
        event_id: opts.threadRoot,
        is_falling_back: true,
        'm.in_reply_to': { event_id: opts.threadRoot },
      };
    }
    if (opts.mentions?.length) extra['m.mentions'] = { user_ids: opts.mentions };
    return extra;
  }

  async sendText(roomId: string, body: string, html?: string, opts: MatrixMessageOptions = {}): Promise<string> {
    const content: Record<string, unknown> = { msgtype: 'm.text', body };
    if (html) Object.assign(content, { format: 'org.matrix.custom.html', formatted_body: html });
    if (opts.replaces) {
      return this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: `* ${body}`,
        ...(html ? { format: 'org.matrix.custom.html', formatted_body: `* ${html}` } : {}),
        'm.new_content': content,
        'm.relates_to': { rel_type: 'm.replace', event_id: opts.replaces },
      });
    }
    return this.client.sendEvent(roomId, 'm.room.message', { ...content, ...this.relations(opts) });
  }

  async sendImage(roomId: string, image: MatrixImage, opts: MatrixMessageOptions = {}): Promise<string> {
    const info = { mimetype: image.mime, size: image.data.length, w: image.width, h: image.height };
    const content: Record<string, unknown> = { msgtype: 'm.image', body: image.name, info, ...this.relations(opts) };
    if (this.client.crypto && (await this.client.crypto.isRoomEncrypted(roomId))) {
      const encrypted = await this.client.crypto.encryptMedia(image.data);
      const url = await this.client.uploadContent(encrypted.buffer, 'application/octet-stream');
      content['file'] = { ...encrypted.file, url };
    } else {
      content['url'] = await this.client.uploadContent(image.data, image.mime, image.name);
    }
    return this.client.sendEvent(roomId, 'm.room.message', content);
  }

  async downloadMedia(content: Record<string, unknown>): Promise<Buffer> {
    const file = content['file'] as { url: string } | undefined;
    if (file) {
      if (!this.client.crypto) throw new Error('encrypted media without crypto');
      return this.client.crypto.decryptMedia(file as never);
    }
    const res = await this.client.downloadContent(content['url'] as string);
    return res.data;
  }

  getJoinedRooms(): Promise<string[]> {
    return this.client.getJoinedRooms();
  }

  private async state<T>(roomId: string, type: string): Promise<T | undefined> {
    try {
      return (await this.client.getRoomStateEvent(roomId, type, '')) as T;
    } catch {
      return undefined;
    }
  }

  async getRoomInfo(roomId: string): Promise<MatrixRoomInfo> {
    const [name, alias, enc, members] = await Promise.all([
      this.state<{ name?: string }>(roomId, 'm.room.name'),
      this.state<{ alias?: string }>(roomId, 'm.room.canonical_alias'),
      this.state<{ algorithm?: string }>(roomId, 'm.room.encryption'),
      this.client.getJoinedRoomMembers(roomId).catch(() => [] as string[]),
    ]);
    return { roomId, name: name?.name, alias: alias?.alias, encrypted: !!enc?.algorithm, memberCount: members.length };
  }

  getJoinedMembers(roomId: string): Promise<string[]> {
    return this.client.getJoinedRoomMembers(roomId);
  }

  async getDisplayName(userId: string): Promise<string | undefined> {
    try {
      const p = await this.client.getUserProfile(userId);
      return p?.displayname ?? undefined;
    } catch {
      return undefined;
    }
  }

  async resolveRoom(idOrAlias: string): Promise<string | undefined> {
    if (idOrAlias.startsWith('!')) return idOrAlias;
    try {
      return await this.client.resolveRoom(idOrAlias);
    } catch {
      return undefined;
    }
  }

  joinRoom(idOrAlias: string): Promise<string> {
    return this.client.joinRoom(idOrAlias);
  }

  async ensureDm(userId: string): Promise<string> {
    return this.client.dms.getOrCreateDm(userId);
  }
}

/** Converts raw (decrypted) events into MatrixIncoming. */
export function normalise(roomId: string, event: RawEvent): MatrixIncoming | null {
  const c = event.content ?? {};
  if (event.type === 'm.reaction') {
    const rel = c['m.relates_to'];
    if (rel?.rel_type !== 'm.annotation') return null;
    return { kind: 'reaction', roomId, eventId: event.event_id, sender: event.sender, relatesTo: rel.event_id, key: String(rel.key ?? '') };
  }
  if (event.type !== 'm.room.message') return null;
  const rel = c['m.relates_to'];
  if (rel?.rel_type === 'm.replace') return null; // ignore edits
  let body = String(c['body'] ?? '');
  // Strip reply fallbacks ("> <@user> …").
  if (rel?.['m.in_reply_to'] && !rel?.is_falling_back) body = body.replace(/^(>.*\n)+\n?/, '');
  return {
    kind: 'message',
    roomId,
    eventId: event.event_id,
    sender: event.sender,
    msgtype: String(c['msgtype'] ?? ''),
    body: body.trim(),
    threadRoot: rel?.rel_type === 'm.thread' ? rel.event_id : undefined,
    content: c,
  };
}
