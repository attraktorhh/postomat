/** Small HTTP helpers for the image routes (pure, testable). */

/** True when the browser's cached copy (If-None-Match) is still current. */
export function notModified(request: Request, etag: string): boolean {
  const header = request.headers.get('if-none-match');
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .includes(`"${etag}"`);
}

/**
 * Cache headers for a private image. A versioned URL (its id matches the
 * served content) can be cached for a year; otherwise the browser revalidates
 * with the ETag every time, which is cheap thanks to 304.
 */
export function imageCacheHeaders(
  etag: string,
  versioned: boolean,
): Record<string, string> {
  return {
    etag: `"${etag}"`,
    'cache-control': versioned
      ? 'private, max-age=31536000, immutable'
      : 'private, no-cache',
  };
}
