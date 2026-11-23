import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/** Where photos and banners are stored. */
export interface MediaStore {
  readonly kind: 'webdav' | 'local';
  ensureDir(path: string): Promise<void>;
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer>;
}

/** Local folder fallback when Nextcloud is not configured (dev only). */
export class LocalFileStore implements MediaStore {
  readonly kind = 'local' as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private abs(path: string): string {
    const p = resolve(join(this.root, path));
    if (!p.startsWith(this.root)) throw new Error('path escapes media root');
    return p;
  }
  async ensureDir(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true });
  }
  async put(path: string, data: Buffer): Promise<void> {
    await mkdir(dirname(this.abs(path)), { recursive: true });
    await writeFile(this.abs(path), data);
  }
  async get(path: string): Promise<Buffer> {
    return readFile(this.abs(path));
  }
}
