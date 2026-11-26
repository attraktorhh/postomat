import {
  basicAuth,
  HttpError,
  timeoutSignal,
  trimSlash,
  type FetchLike,
} from '@postomat/core';

export interface WordPressConfig {
  /** Site URL, e.g. http://localhost:8081 */
  baseUrl: string;
  username: string;
  /** Application password (spaces allowed). */
  appPassword: string;
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 15 s; media uploads get 4×). */
  timeoutMs?: number;
}

/** Category slugs from the config that don't exist in WordPress. */
export class CategoryNotFoundError extends Error {
  readonly slugs: string[];
  constructor(slugs: string[]) {
    super(`WordPress categories not found: ${slugs.join(', ')}`);
    this.name = 'CategoryNotFoundError';
    this.slugs = slugs;
  }
}

export interface WpPostRef {
  id: number;
  link: string;
  status: string;
}

/** WordPress REST client for the small API subset Postomat needs. */
export class WordPressClient {
  private readonly api: string;
  private readonly fetchFn: FetchLike;
  private readonly auth: string;
  private readonly timeoutMs?: number;

  constructor(cfg: WordPressConfig) {
    this.timeoutMs = cfg.timeoutMs;
    this.api = `${trimSlash(cfg.baseUrl)}/wp-json/wp/v2`;
    this.fetchFn = cfg.fetch ?? fetch;
    this.auth = basicAuth(cfg.username, cfg.appPassword.replace(/\s+/g, ''));
  }

  private async request<T>(
    path: string,
    init: RequestInit & {
      headers?: Record<string, string>;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const { timeoutMs, ...rest } = init;
    const res = await this.fetchFn(`${this.api}${path}`, {
      ...rest,
      signal: timeoutSignal(timeoutMs ?? this.timeoutMs),
      headers: {
        authorization: this.auth,
        accept: 'application/json',
        ...(rest.headers ?? {}),
      },
    });
    const text = await res.text();
    if (!res.ok)
      throw new HttpError(
        `WordPress ${init.method ?? 'GET'} ${path}`,
        res.status,
        text,
      );
    return JSON.parse(text) as T;
  }

  async me(): Promise<{ id: number; slug: string; name: string }> {
    return this.request('/users/me?context=edit');
  }

  /** Resolves category slugs to IDs. Unknown slugs are reported as an error. */
  async resolveCategoryIds(slugs: string[]): Promise<number[]> {
    if (!slugs.length) return [];
    const found = await this.request<Array<{ id: number; slug: string }>>(
      `/categories?per_page=100&slug=${slugs.map(encodeURIComponent).join(',')}`,
    );
    const missing = slugs.filter((s) => !found.some((c) => c.slug === s));
    if (missing.length) throw new CategoryNotFoundError(missing);
    return slugs.map((s) => found.find((c) => c.slug === s)!.id);
  }

  async uploadMedia(
    data: Buffer,
    filename: string,
    mime: string,
    altText?: string,
  ): Promise<{ id: number; url: string }> {
    const media = await this.request<{ id: number; source_url: string }>(
      '/media',
      {
        method: 'POST',
        timeoutMs: (this.timeoutMs ?? 15_000) * 4,
        headers: {
          'content-type': mime,
          'content-disposition': `attachment; filename="${filename}"`,
        },
        body: new Uint8Array(data),
      },
    );
    if (altText) {
      await this.request(`/media/${media.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alt_text: altText }),
      });
    }
    return { id: media.id, url: media.source_url };
  }

  async findPostBySlug(slug: string): Promise<WpPostRef | null> {
    const list = await this.request<
      Array<{ id: number; link: string; status: string }>
    >(
      `/posts?context=edit&status=publish,draft,future,pending,private&slug=${encodeURIComponent(slug)}`,
    );
    const p = list[0];
    return p ? { id: p.id, link: p.link, status: p.status } : null;
  }

  async getPost(id: number): Promise<
    WpPostRef & {
      content: string;
      categories: number[];
      featured_media: number;
      title: string;
    }
  > {
    const p = await this.request<{
      id: number;
      link: string;
      status: string;
      content: { raw?: string; rendered: string };
      title: { raw?: string; rendered: string };
      categories: number[];
      featured_media: number;
    }>(`/posts/${id}?context=edit`);
    return {
      id: p.id,
      link: p.link,
      status: p.status,
      content: p.content.raw ?? p.content.rendered,
      title: p.title.raw ?? p.title.rendered,
      categories: p.categories,
      featured_media: p.featured_media,
    };
  }

  async createPost(input: {
    title: string;
    content: string;
    status: 'publish' | 'draft';
    slug: string;
    categories: number[];
    featuredMedia?: number;
  }): Promise<WpPostRef> {
    const p = await this.request<{ id: number; link: string; status: string }>(
      '/posts',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          content: input.content,
          status: input.status,
          slug: input.slug,
          categories: input.categories,
          featured_media: input.featuredMedia,
        }),
      },
    );
    return { id: p.id, link: p.link, status: p.status };
  }

  async updatePost(
    id: number,
    input: { content?: string; title?: string },
  ): Promise<WpPostRef> {
    const p = await this.request<{ id: number; link: string; status: string }>(
      `/posts/${id}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
    return { id: p.id, link: p.link, status: p.status };
  }

  async deletePost(id: number): Promise<void> {
    await this.request(`/posts/${id}?force=true`, { method: 'DELETE' });
  }
}
