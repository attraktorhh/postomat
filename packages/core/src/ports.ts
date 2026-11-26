/**
 * Small Matrix interface the application needs. `apps/bot` implements it with
 * matrix-bot-sdk (E2EE), `@postomat/testing` with an in-memory fake.
 */
export interface MatrixMessageOptions {
  /** Send as a reply inside this thread root (m.thread). */
  threadRoot?: string;
  /** Replace (edit) an earlier event (m.replace). */
  replaces?: string;
  /** Matrix IDs mentioned (m.mentions + pill). */
  mentions?: string[];
}

export interface MatrixImage {
  data: Buffer;
  mime: string;
  name: string;
  width?: number;
  height?: number;
}

export interface MatrixRoomInfo {
  roomId: string;
  name?: string;
  alias?: string;
  memberCount: number;
  encrypted: boolean;
  /** Known to be a direct-message room (m.direct). */
  direct?: boolean;
}

export interface MatrixPort {
  readonly userId: string;
  sendText(
    roomId: string,
    body: string,
    html?: string,
    opts?: MatrixMessageOptions,
  ): Promise<string>;
  sendImage(
    roomId: string,
    image: MatrixImage,
    opts?: MatrixMessageOptions,
  ): Promise<string>;
  /** Downloads (and decrypts, for encrypted rooms) the media of an m.image content. */
  downloadMedia(content: Record<string, unknown>): Promise<Buffer>;
  getJoinedRooms(): Promise<string[]>;
  getRoomInfo(roomId: string): Promise<MatrixRoomInfo>;
  getJoinedMembers(roomId: string): Promise<string[]>;
  getDisplayName(userId: string): Promise<string | undefined>;
  /** Resolves `#alias:server` to a room ID; returns room IDs unchanged. */
  resolveRoom(idOrAlias: string): Promise<string | undefined>;
  joinRoom(idOrAlias: string): Promise<string>;
  /** Returns an existing DM room with the user or creates an encrypted one. */
  ensureDm(userId: string): Promise<string>;
}

/** Normalised incoming Matrix events. */
export type MatrixIncoming =
  | {
      kind: 'message';
      roomId: string;
      eventId: string;
      sender: string;
      msgtype: string;
      body: string;
      /** Thread root when the message is in a thread. */
      threadRoot?: string;
      /** Raw content, needed for media download. */
      content: Record<string, unknown>;
    }
  | {
      kind: 'reaction';
      roomId: string;
      eventId: string;
      sender: string;
      relatesTo: string;
      key: string;
    }
  | { kind: 'invite'; roomId: string; sender: string };
