import { checkBasic, startServer, type FakeServer } from './server.ts';

/** In-process fake WebDAV (Nextcloud) server: MKCOL, PUT, GET, PROPFIND, DELETE. */
export class FakeWebDav {
  readonly username = 'postomat';
  readonly password = 'fake-nextcloud';
  readonly dirs = new Set<string>(['/']);
  readonly files = new Map<string, { data: Buffer; type: string }>();
  private server?: FakeServer;

  /** WebDAV base URL, like Nextcloud's /remote.php/dav/files/<user>. */
  get url(): string {
    return `${this.server!.url}/remote.php/dav/files/postomat`;
  }

  async start(): Promise<this> {
    this.server = await startServer(async (req, body, res) => {
      if (!checkBasic(req, this.username, this.password)) {
        res.writeHead(401).end();
        return;
      }
      const prefix = '/remote.php/dav/files/postomat';
      const raw = new URL(req.url ?? '/', 'http://x').pathname;
      if (!raw.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      const path =
        decodeURIComponent(raw.slice(prefix.length)).replace(/\/+$/, '') || '/';
      const parent = path.split('/').slice(0, -1).join('/') || '/';
      switch (req.method) {
        case 'MKCOL':
          if (this.dirs.has(path) || this.files.has(path))
            return void res.writeHead(405).end();
          if (!this.dirs.has(parent)) return void res.writeHead(409).end();
          this.dirs.add(path);
          return void res.writeHead(201).end();
        case 'PUT':
          if (!this.dirs.has(parent)) return void res.writeHead(409).end();
          this.files.set(path, {
            data: body,
            type: String(
              req.headers['content-type'] ?? 'application/octet-stream',
            ),
          });
          return void res.writeHead(201).end();
        case 'GET': {
          const f = this.files.get(path);
          if (!f) return void res.writeHead(404).end();
          res.writeHead(200, { 'content-type': f.type });
          return void res.end(f.data);
        }
        case 'PROPFIND':
          if (!this.dirs.has(path) && !this.files.has(path))
            return void res.writeHead(404).end();
          res.writeHead(207, { 'content-type': 'application/xml' });
          return void res.end(
            `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>${prefix}${path}</d:href></d:response></d:multistatus>`,
          );
        case 'DELETE':
          this.files.delete(path);
          this.dirs.delete(path);
          return void res.writeHead(204).end();
        default:
          res.writeHead(405).end();
      }
    });
    return this;
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
