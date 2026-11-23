import type { MatrixImage, MatrixMessageOptions, MatrixPort, MatrixRoomInfo } from '@postomat/core';

export interface SentMessage {
  eventId: string;
  roomId: string;
  kind: 'text' | 'image';
  body: string;
  html?: string;
  image?: MatrixImage;
  opts: MatrixMessageOptions;
}

export interface FakeRoom {
  roomId: string;
  alias?: string;
  name?: string;
  members: Set<string>;
  encrypted: boolean;
}

/** In-memory Matrix homeserver view for tests. */
export class FakeMatrix implements MatrixPort {
  readonly userId: string;
  readonly rooms = new Map<string, FakeRoom>();
  readonly sent: SentMessage[] = [];
  readonly media = new Map<string, Buffer>();
  readonly displayNames = new Map<string, string>();
  private counter = 0;

  constructor(userId = '@postomat:localhost') {
    this.userId = userId;
  }

  addRoom(roomId: string, members: string[], opts: { alias?: string; name?: string; encrypted?: boolean } = {}): FakeRoom {
    const room: FakeRoom = { roomId, alias: opts.alias, name: opts.name, members: new Set(members), encrypted: opts.encrypted ?? true };
    this.rooms.set(roomId, room);
    return room;
  }

  /** Stores media and returns an m.image content pointing at it. */
  uploadImage(data: Buffer, mime = 'image/jpeg'): Record<string, unknown> {
    const url = `mxc://localhost/${++this.counter}`;
    this.media.set(url, data);
    return { msgtype: 'm.image', body: 'photo.jpg', file: { url }, info: { mimetype: mime, size: data.length } };
  }

  newEventId(): string {
    return `$evt${++this.counter}`;
  }

  async sendText(roomId: string, body: string, html?: string, opts: MatrixMessageOptions = {}): Promise<string> {
    const eventId = this.newEventId();
    this.sent.push({ eventId, roomId, kind: 'text', body, html, opts });
    return eventId;
  }

  async sendImage(roomId: string, image: MatrixImage, opts: MatrixMessageOptions = {}): Promise<string> {
    const eventId = this.newEventId();
    this.sent.push({ eventId, roomId, kind: 'image', body: image.name, image, opts });
    return eventId;
  }

  async downloadMedia(content: Record<string, unknown>): Promise<Buffer> {
    const url = ((content['file'] as { url?: string } | undefined)?.url ?? content['url']) as string;
    const data = this.media.get(url);
    if (!data) throw new Error(`unknown media ${url}`);
    return data;
  }

  async getJoinedRooms(): Promise<string[]> {
    return [...this.rooms.values()].filter((r) => r.members.has(this.userId)).map((r) => r.roomId);
  }

  async getRoomInfo(roomId: string): Promise<MatrixRoomInfo> {
    const r = this.rooms.get(roomId);
    if (!r) throw new Error(`unknown room ${roomId}`);
    return { roomId, name: r.name, alias: r.alias, memberCount: r.members.size, encrypted: r.encrypted };
  }

  async getJoinedMembers(roomId: string): Promise<string[]> {
    return [...(this.rooms.get(roomId)?.members ?? [])];
  }

  async getDisplayName(userId: string): Promise<string | undefined> {
    return this.displayNames.get(userId) ?? userId.slice(1).split(':')[0].replace(/^./, (c) => c.toUpperCase());
  }

  async resolveRoom(idOrAlias: string): Promise<string | undefined> {
    if (idOrAlias.startsWith('!')) return this.rooms.has(idOrAlias) ? idOrAlias : undefined;
    return [...this.rooms.values()].find((r) => r.alias === idOrAlias)?.roomId;
  }

  async joinRoom(idOrAlias: string): Promise<string> {
    const id = await this.resolveRoom(idOrAlias);
    if (!id) throw new Error(`unknown room ${idOrAlias}`);
    this.rooms.get(id)!.members.add(this.userId);
    return id;
  }

  async ensureDm(userId: string): Promise<string> {
    const existing = [...this.rooms.values()].find(
      (r) => r.members.size === 2 && r.members.has(userId) && r.members.has(this.userId) && !r.alias,
    );
    if (existing) return existing.roomId;
    return this.addRoom(`!dm-${userId.slice(1).split(':')[0]}:localhost`, [this.userId, userId]).roomId;
  }

  /** Messages sent to a room (optionally only inside a thread). */
  messages(roomId: string, threadRoot?: string): SentMessage[] {
    return this.sent.filter((m) => m.roomId === roomId && (threadRoot === undefined || m.opts.threadRoot === threadRoot));
  }

  /** Latest content of an event, following m.replace edits. */
  latest(eventId: string): SentMessage | undefined {
    const edits = this.sent.filter((m) => m.opts.replaces === eventId);
    return edits.at(-1) ?? this.sent.find((m) => m.eventId === eventId);
  }
}
