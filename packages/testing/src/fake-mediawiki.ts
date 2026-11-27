import { randomUUID } from 'node:crypto';
import { json, startServer, type FakeServer } from './server.ts';

/** In-process fake of the MediaWiki Action API subset (login, tokens, edit, revisions). */
export class FakeMediaWiki {
  readonly username = 'Postomat@postomat';
  readonly password = 'fakebotpasswordfakebotpassword12';
  pages = new Map<string, string>();
  edits: Array<{ title: string; summary: string }> = [];
  /** Save the next N edits but answer HTTP 500 (a crash after the write). */
  failAfterNextEdits = 0;
  private server?: FakeServer;
  private sessions = new Map<
    string,
    { loggedIn: boolean; loginToken: string; csrf: string }
  >();

  get apiUrl(): string {
    return `${this.server!.url}/api.php`;
  }

  async start(): Promise<this> {
    this.server = await startServer(async (req, body, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      if (u.pathname !== '/api.php') return json(res, 404, {});
      const params = new URLSearchParams(u.search);
      if (req.method === 'POST')
        for (const [k, v] of new URLSearchParams(body.toString()))
          params.set(k, v);
      const sid = /fakewiki_session=([^;]+)/.exec(
        String(req.headers.cookie ?? ''),
      )?.[1];
      let session = sid ? this.sessions.get(sid) : undefined;
      const headers: Record<string, string> = {};
      if (!session) {
        const id = randomUUID();
        session = {
          loggedIn: false,
          loginToken: randomUUID() + '+\\',
          csrf: randomUUID() + '+\\',
        };
        this.sessions.set(id, session);
        headers['set-cookie'] = `fakewiki_session=${id}; path=/; HttpOnly`;
      }
      const err = (code: string, info: string) =>
        json(res, 200, { error: { code, info } }, headers);
      const action = params.get('action');
      if (params.get('assert') === 'user' && !session.loggedIn)
        return err('assertuserfailed', 'You are no longer logged in.');
      if (action === 'query' && params.get('meta') === 'tokens') {
        const type = params.get('type') ?? 'csrf';
        if (type === 'login')
          return json(
            res,
            200,
            { query: { tokens: { logintoken: session.loginToken } } },
            headers,
          );
        return json(
          res,
          200,
          {
            query: {
              tokens: { csrftoken: session.loggedIn ? session.csrf : '+\\' },
            },
          },
          headers,
        );
      }
      if (action === 'login') {
        if (params.get('lgtoken') !== session.loginToken)
          return json(res, 200, { login: { result: 'WrongToken' } }, headers);
        const ok =
          params.get('lgname') === this.username &&
          params.get('lgpassword') === this.password;
        session.loggedIn = ok;
        return json(
          res,
          200,
          {
            login: ok
              ? { result: 'Success', lgusername: 'Postomat' }
              : {
                  result: 'Failed',
                  reason: 'Incorrect username or password entered.',
                },
          },
          headers,
        );
      }
      if (action === 'query' && params.get('prop') === 'revisions') {
        const title = params.get('titles') ?? '';
        const text = this.pages.get(title);
        const page =
          text === undefined
            ? { title, missing: true }
            : { title, revisions: [{ slots: { main: { content: text } } }] };
        return json(res, 200, { query: { pages: [page] } }, headers);
      }
      if (action === 'edit') {
        if (req.method !== 'POST') return err('mustbeposted', 'POST required');
        if (!session.loggedIn || params.get('token') !== session.csrf)
          return err('badtoken', 'Invalid CSRF token.');
        const title = params.get('title') ?? '';
        const exists = this.pages.has(title);
        if (params.get('createonly') && exists)
          return err(
            'articleexists',
            'The article you tried to create has been created already.',
          );
        if (params.get('nocreate') && !exists)
          return err('missingtitle', "The page you specified doesn't exist.");
        this.pages.set(title, params.get('text') ?? '');
        this.edits.push({ title, summary: params.get('summary') ?? '' });
        if (this.failAfterNextEdits > 0) {
          this.failAfterNextEdits--;
          return json(res, 500, { error: 'internal' }, headers);
        }
        return json(
          res,
          200,
          { edit: { result: 'Success', title, newrevid: this.edits.length } },
          headers,
        );
      }
      return err('badvalue', `Unsupported action ${action}`);
    });
    return this;
  }

  /** Ends every session, like the wiki's session store expiring. */
  expireSessions(): void {
    this.sessions.clear();
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
