import { HttpError, timeoutSignal, type FetchLike } from '@postomat/core';

export interface MediaWikiConfig {
  /** e.g. http://localhost:8082/api.php */
  apiUrl: string;
  /** BotPassword login name, e.g. "Postomat@postomat". */
  username: string;
  password: string;
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 15 s). */
  timeoutMs?: number;
}

export class PageExistsError extends Error {
  readonly title: string;
  constructor(title: string) {
    super(`Wiki page already exists: ${title}`);
    this.name = 'PageExistsError';
    this.title = title;
  }
}

export class MediaWikiError extends Error {
  readonly code: string;
  constructor(code: string, info: string) {
    super(`MediaWiki error ${code}: ${info}`);
    this.name = 'MediaWikiError';
    this.code = code;
  }
}

/** Error codes after which a fresh login (new session + CSRF token) may help. */
const SESSION_ERRORS = new Set(['badtoken', 'notloggedin', 'assertuserfailed']);

/**
 * MediaWiki Action API client: BotPassword login, CSRF token, edit. Sessions
 * expire on the wiki side, so edits log in again once on a session error.
 */
export class MediaWikiClient {
  private readonly cfg: MediaWikiConfig;
  private readonly fetchFn: FetchLike;
  private readonly cookies = new Map<string, string>();
  private csrf?: string;
  private loggedIn = false;

  constructor(cfg: MediaWikiConfig) {
    this.cfg = cfg;
    this.fetchFn = cfg.fetch ?? fetch;
  }

  private cookieHeader(): string {
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(res: Response): void {
    const list =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [];
    for (const c of list) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0)
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  private async call(
    params: Record<string, string>,
    post = false,
  ): Promise<Record<string, any>> {
    const qs = new URLSearchParams({
      format: 'json',
      formatversion: '2',
      ...params,
    });
    const init: RequestInit = {
      signal: timeoutSignal(this.cfg.timeoutMs),
      headers: {
        cookie: this.cookieHeader(),
        'user-agent': 'Postomat/1.0 (dev)',
      },
    };
    let url = this.cfg.apiUrl;
    if (post) {
      init.method = 'POST';
      init.body = qs;
      (init.headers as Record<string, string>)['content-type'] =
        'application/x-www-form-urlencoded';
    } else {
      url += `?${qs}`;
    }
    const res = await this.fetchFn(url, init);
    this.storeCookies(res);
    const text = await res.text();
    if (!res.ok)
      throw new HttpError(`MediaWiki ${params['action']}`, res.status, text);
    const json = JSON.parse(text) as Record<string, any>;
    if (json['error'])
      throw new MediaWikiError(json['error'].code, json['error'].info);
    return json;
  }

  /** Forgets the session, so the next edit logs in from scratch. */
  private resetSession(): void {
    this.cookies.clear();
    this.csrf = undefined;
    this.loggedIn = false;
  }

  async login(): Promise<void> {
    this.resetSession();
    try {
      await this.doLogin();
    } catch (e) {
      this.resetSession();
      throw e;
    }
    this.loggedIn = true;
  }

  private async doLogin(): Promise<void> {
    const t = await this.call({
      action: 'query',
      meta: 'tokens',
      type: 'login',
    });
    const r = await this.call(
      {
        action: 'login',
        lgname: this.cfg.username,
        lgpassword: this.cfg.password,
        lgtoken: t['query'].tokens.logintoken,
      },
      true,
    );
    if (r['login']?.result !== 'Success') {
      throw new MediaWikiError(
        'login',
        r['login']?.reason ?? r['login']?.result ?? 'unknown',
      );
    }
  }

  private async token(): Promise<string> {
    if (this.csrf) return this.csrf;
    const t = await this.call({
      action: 'query',
      meta: 'tokens',
      type: 'csrf',
    });
    const token = t['query'].tokens.csrftoken as string;
    if (!token || token === '+\\')
      throw new MediaWikiError('notloggedin', 'no csrf token (login failed?)');
    this.csrf = token;
    return token;
  }

  private async ensureLogin(): Promise<void> {
    if (!this.loggedIn) await this.login();
  }

  /** An edit as the bot user; on a session error it logs in again and retries once. */
  private async edit(
    params: Record<string, string>,
  ): Promise<Record<string, any>> {
    await this.ensureLogin();
    const send = async () =>
      this.call(
        {
          action: 'edit',
          bot: '1',
          assert: 'user',
          ...params,
          token: await this.token(),
        },
        true,
      );
    try {
      return await send();
    } catch (e) {
      if (!(e instanceof MediaWikiError && SESSION_ERRORS.has(e.code))) throw e;
      await this.login();
      return send();
    }
  }

  async getPageText(title: string): Promise<string | null> {
    const r = await this.call({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      titles: title,
    });
    const page = r['query']?.pages?.[0];
    if (!page || page.missing) return null;
    return page.revisions?.[0]?.slots?.main?.content ?? null;
  }

  async pageExists(title: string): Promise<boolean> {
    return (await this.getPageText(title)) !== null;
  }

  /** Creates a page; fails with PageExistsError if it exists (never overwrites). */
  async createPage(
    title: string,
    text: string,
    summary: string,
  ): Promise<{ title: string; revid: number }> {
    try {
      const r = await this.edit({ title, text, summary, createonly: '1' });
      return { title: r['edit'].title, revid: r['edit'].newrevid };
    } catch (e) {
      if (e instanceof MediaWikiError && e.code === 'articleexists')
        throw new PageExistsError(title);
      throw e;
    }
  }

  /** Replaces the text of an existing page (never creates). */
  async updatePage(
    title: string,
    text: string,
    summary: string,
  ): Promise<{ title: string; revid?: number }> {
    const r = await this.edit({ title, text, summary, nocreate: '1' });
    return { title: r['edit'].title, revid: r['edit'].newrevid };
  }
}

/** Public URL of a page, e.g. http://localhost:8082/index.php/Termin:Foo_2026-12-11 */
export function wikiPageUrl(pageBaseUrl: string, title: string): string {
  const base = pageBaseUrl.endsWith('/') ? pageBaseUrl : `${pageBaseUrl}/`;
  return (
    base +
    encodeURIComponent(title.replace(/ /g, '_'))
      .replace(/%3A/g, ':')
      .replace(/%2F/g, '/')
  );
}
