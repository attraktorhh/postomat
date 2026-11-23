import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LogLevel, LogService, MatrixClient, RustSdkCryptoStorageProvider, SimpleFsStorageProvider } from 'matrix-bot-sdk';

/**
 * A scripted E2EE Matrix user for smoke tests against the compose stack.
 * Each user gets its own device and crypto store under `.data/smoke/<user>`.
 */
export class StackUser {
  readonly client: MatrixClient;
  readonly userId: string;
  private readonly inbox: Array<{ roomId: string; event: any }> = [];

  private constructor(client: MatrixClient, userId: string) {
    this.client = client;
    this.userId = userId;
    client.on('room.event', (roomId: string, event: any) => {
      if (event.sender !== userId) this.inbox.push({ roomId, event });
    });
    client.on('room.failed_decryption', (roomId: string, event: any, e: Error) => {
      console.warn(`[${userId}] failed to decrypt ${event.event_id} in ${roomId}: ${e?.message}`);
    });
  }

  static async login(homeserver: string, user: string, password: string, dataRoot = '.data/smoke'): Promise<StackUser> {
    LogService.setLevel(LogLevel.ERROR);
    const dir = join(dataRoot, user);
    await mkdir(dir, { recursive: true });
    const res = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: 'POST',
      body: JSON.stringify({ type: 'm.login.password', identifier: { type: 'm.id.user', user }, password, device_id: `SMOKE${user.toUpperCase()}` }),
    });
    if (!res.ok) throw new Error(`login ${user}: ${res.status} ${await res.text()}`);
    const { access_token, user_id } = (await res.json()) as { access_token: string; user_id: string };
    const client = new MatrixClient(
      homeserver,
      access_token,
      new SimpleFsStorageProvider(join(dir, 'sync.json')),
      new RustSdkCryptoStorageProvider(join(dir, 'crypto'), 0),
    );
    const u = new StackUser(client, user_id);
    await client.start();
    return u;
  }

  /** Waits for a message matching `pred` (decrypted) in a room. */
  async waitFor(roomId: string, pred: (body: string, event: any) => boolean, timeoutMs = 30000): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const idx = this.inbox.findIndex(
        (m) => m.roomId === roomId && m.event.type === 'm.room.message' && pred(String(m.event.content?.body ?? ''), m.event),
      );
      if (idx >= 0) return this.inbox.splice(idx, 1)[0].event;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`timeout waiting for message in ${roomId}`);
  }

  async say(roomId: string, body: string): Promise<string> {
    return this.client.sendText(roomId, body);
  }

  async sendPhoto(roomId: string, data: Buffer, mime = 'image/jpeg'): Promise<string> {
    const encrypted = await this.client.crypto.encryptMedia(data);
    const url = await this.client.uploadContent(encrypted.buffer, 'application/octet-stream');
    return this.client.sendEvent(roomId, 'm.room.message', {
      msgtype: 'm.image',
      body: 'foto.jpg',
      info: { mimetype: mime, size: data.length },
      file: { ...encrypted.file, url },
    });
  }

  stop(): void {
    this.client.stop();
  }
}
