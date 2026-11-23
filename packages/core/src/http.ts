/** Shared helpers for small HTTP clients. */
export type FetchLike = typeof fetch;

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(`${message}: HTTP ${status} ${body.slice(0, 300)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export const basicAuth = (user: string, password: string): string =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');
