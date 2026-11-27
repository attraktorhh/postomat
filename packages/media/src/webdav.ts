import {
  basicAuth,
  HttpError,
  trimSlash,
  type FetchLike,
} from '@postomat/core';
import type { MediaStore } from './store.ts';

export interface WebDavConfig {
  /** e.g. http://localhost:8083/remote.php/dav/files/postomat */
  baseUrl: string;
  username?: string;
  password?: string;
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
}

/** Minimal WebDAV client for Nextcloud (MKCOL, PUT, GET, PROPFIND, DELETE). */
export class WebDavClient implements MediaStore {
  readonly kind = 'webdav' as const;
  private readonly base: string;
  private readonly fetchFn: FetchLike;
  private readonly cfg: WebDavConfig;

  constructor(cfg: WebDavConfig) {
    this.cfg = cfg;
    this.base = trimSlash(cfg.baseUrl);
    const raw = cfg.fetch ?? fetch;
    const timeout = cfg.timeoutMs ?? 15_000;
    this.fetchFn = (input, init) =>
      raw(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeout),
      });
  }

  private url(path: string): string {
    const segments = path.split('/').filter(Boolean);
    if (segments.some((s) => s === '.' || s === '..'))
      throw new Error(`invalid WebDAV path: ${path}`);
    const clean = segments.map((s) => encodeURIComponent(s)).join('/');
    return `${this.base}/${clean}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.cfg.username && this.cfg.password)
      h['authorization'] = basicAuth(this.cfg.username, this.cfg.password);
    return h;
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.fetchFn(this.url(path), {
      method: 'PROPFIND',
      headers: this.headers({ depth: '0' }),
    });
    await res.arrayBuffer();
    if (res.status === 404) return false;
    if (res.status === 207 || res.ok) return true;
    throw new HttpError(`PROPFIND ${path}`, res.status, '');
  }

  /** Creates every missing folder of `path` (like mkdir -p). */
  async ensureDir(path: string): Promise<void> {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      const res = await this.fetchFn(this.url(current), {
        method: 'MKCOL',
        headers: this.headers(),
      });
      const text = await res.text();
      // 201 created, 405 already exists
      if (res.status !== 201 && res.status !== 405 && !res.ok)
        throw new HttpError(`MKCOL ${current}`, res.status, text);
    }
  }

  async put(path: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.fetchFn(this.url(path), {
      method: 'PUT',
      headers: this.headers({ 'content-type': contentType }),
      body: new Uint8Array(body),
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(`PUT ${path}`, res.status, text);
  }

  async get(path: string): Promise<Buffer> {
    const res = await this.fetchFn(this.url(path), { headers: this.headers() });
    if (!res.ok)
      throw new HttpError(`GET ${path}`, res.status, await res.text());
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const res = await this.fetchFn(this.url(path), {
      method: 'DELETE',
      headers: this.headers(),
    });
    await res.arrayBuffer();
    if (!res.ok && res.status !== 404)
      throw new HttpError(`DELETE ${path}`, res.status, '');
  }
}

/** `/Postomat-Fotos/YYYY/YYYY-MM-DD-<slug>` */
export function photoFolder(
  baseFolder: string,
  date: string,
  slug: string,
): string {
  const base = `/${baseFolder.replace(/^\/+|\/+$/g, '')}`;
  return `${base}/${date.slice(0, 4)}/${date}-${slug || 'beitrag'}`;
}
