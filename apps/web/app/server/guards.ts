/** Pure request guards (no env, no DB), shared by the auth code and tests. */

/**
 * A login return path must stay on this site: one leading slash, not followed
 * by a second slash or a backslash (`//evil.example`, `/\evil.example`), and
 * free of control characters and spaces.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return '/';
  // Browsers drop tabs/newlines while parsing a URL ("/\t/evil" → "//evil"),
  // so no control characters or spaces at all.
  const hasControlOrSpace = [...value].some((ch) => {
    const code = ch.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  return /^\/(?![/\\])/.test(value) && !hasControlOrSpace ? value : '/';
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for state-changing requests. A browser always sends `Origin` on a
 * cross-site POST; it must match the public URL or the request's own origin.
 * Without `Origin`, `Sec-Fetch-Site` decides. Requests with neither header do
 * not come from a browser, so they carry no ambient cookies to abuse.
 */
export function isSameOriginRequest(
  request: Request,
  publicUrl: string,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
  const allowed = new Set([new URL(request.url).origin]);
  try {
    allowed.add(new URL(publicUrl).origin);
  } catch {
    // Invalid PUBLIC_WEB_URL: only the request's own origin counts.
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== 'null') return allowed.has(origin);
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  return origin !== 'null';
}
