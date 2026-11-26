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

/** Default timeout for calls to external services (WordPress, MediaWiki, iCal). */
export const HTTP_TIMEOUT_MS = 15_000;

/** Abort signal for one outgoing request, so a hung server never stalls a job. */
export const timeoutSignal = (ms: number = HTTP_TIMEOUT_MS): AbortSignal =>
  AbortSignal.timeout(ms);
