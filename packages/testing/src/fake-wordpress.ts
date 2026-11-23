import { checkBasic, json, startServer, type FakeServer } from './server.ts';

export interface FakeWpPost {
  id: number;
  title: string;
  content: string;
  status: string;
  slug: string;
  categories: number[];
  featured_media: number;
  link: string;
}

/** In-process fake of the WordPress REST API subset Postomat uses. */
export class FakeWordPress {
  readonly username = 'postomat';
  readonly appPassword = 'fake fake fake fake fake fake';
  readonly categories = [
    { id: 6, slug: 'termine', name: 'Termine' },
    { id: 102, slug: 'workshops', name: 'Workshops' },
  ];
  posts: FakeWpPost[] = [];
  media: Array<{
    id: number;
    filename: string;
    mime: string;
    size: number;
    alt_text: string;
  }> = [];
  /** Fail the next N post creations with HTTP 500 (for retry tests). */
  failNextCreates = 0;
  private server?: FakeServer;
  private nextId = 1000;

  get url(): string {
    return this.server!.url;
  }

  async start(): Promise<this> {
    this.server = await startServer(async (req, body, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      if (
        !checkBasic(req, this.username, this.appPassword.replace(/\s+/g, ''))
      ) {
        return json(res, 401, { code: 'rest_not_logged_in' });
      }
      const path = u.pathname.replace(/^\/wp-json\/wp\/v2/, '');
      if (path === '/users/me')
        return json(res, 200, { id: 2, slug: 'postomat', name: 'postomat' });
      if (path === '/categories') {
        const slugs = (u.searchParams.get('slug') ?? '')
          .split(',')
          .filter(Boolean);
        return json(
          res,
          200,
          this.categories.filter(
            (c) => !slugs.length || slugs.includes(c.slug),
          ),
        );
      }
      if (path === '/media' && req.method === 'POST') {
        const filename =
          /filename="([^"]+)"/.exec(
            String(req.headers['content-disposition']),
          )?.[1] ?? 'upload';
        const m = {
          id: this.nextId++,
          filename,
          mime: String(req.headers['content-type']),
          size: body.length,
          alt_text: '',
        };
        this.media.push(m);
        return json(res, 201, {
          id: m.id,
          source_url: `${this.url}/wp-content/uploads/${filename}`,
        });
      }
      const mediaId = /^\/media\/(\d+)$/.exec(path);
      if (mediaId && req.method === 'POST') {
        const m = this.media.find((x) => x.id === Number(mediaId[1]));
        if (!m) return json(res, 404, { code: 'rest_post_invalid_id' });
        Object.assign(m, JSON.parse(body.toString()));
        return json(res, 200, { id: m.id });
      }
      if (path === '/posts' && req.method === 'POST') {
        if (this.failNextCreates > 0) {
          this.failNextCreates--;
          return json(res, 500, { code: 'internal_server_error' });
        }
        const input = JSON.parse(body.toString());
        const slug = input.slug ?? `post-${this.nextId}`;
        const p: FakeWpPost = {
          id: this.nextId++,
          title: input.title,
          content: input.content,
          status: input.status ?? 'draft',
          slug,
          categories: input.categories ?? [],
          featured_media: input.featured_media ?? 0,
          link: `${this.url}/${slug}/`,
        };
        this.posts.push(p);
        return json(res, 201, this.view(p));
      }
      if (path === '/posts' && req.method === 'GET') {
        const slug = u.searchParams.get('slug');
        return json(
          res,
          200,
          this.posts
            .filter((p) => !slug || p.slug === slug)
            .map((p) => this.view(p)),
        );
      }
      const postId = /^\/posts\/(\d+)$/.exec(path);
      if (postId) {
        const p = this.posts.find((x) => x.id === Number(postId[1]));
        if (!p) return json(res, 404, { code: 'rest_post_invalid_id' });
        if (req.method === 'POST')
          Object.assign(p, JSON.parse(body.toString()));
        if (req.method === 'DELETE')
          this.posts = this.posts.filter((x) => x !== p);
        return json(res, 200, this.view(p));
      }
      return json(res, 404, { code: 'rest_no_route' });
    });
    return this;
  }

  private view(p: FakeWpPost) {
    return {
      id: p.id,
      link: p.link,
      status: p.status,
      slug: p.slug,
      title: { raw: p.title, rendered: p.title },
      content: { raw: p.content, rendered: p.content },
      categories: p.categories,
      featured_media: p.featured_media,
    };
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
