import type { LoaderFunctionArgs } from 'react-router';
import { bannerData, latestBanner } from '@postomat/workflow';
import { requirePostAccess } from '../server/access.server';
import { getDeps } from '../server/deps.server';
import { imageCacheHeaders, notModified } from '../server/http';

/**
 * Banner PNG of a post (4x5 or 16x9). `?download=1` → file download ("Bild
 * laden"). `?b=<row id>` (see bannerUrl) makes the URL immutable.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const format = params['format'];
  if (format !== '4x5' && format !== '16x9')
    throw new Response('Nicht gefunden', { status: 404 });
  const { post } = await requirePostAccess(request, params['id']);
  const deps = await getDeps();
  const url = new URL(request.url);
  const latest = await latestBanner(deps.db, post.id, format);
  const fresh =
    latest &&
    latest.version === post.version &&
    latest.bannerColor === post.bannerColor;
  if (fresh && notModified(request, latest.sha256))
    return new Response(null, { status: 304 });
  // Previews never render in a web request: the worker renders (a stale
  // banner queues a throttled job) and the newest existing banner is shown
  // meanwhile. A download ("Bild laden") is what gets posted, so it must be
  // current and renders when needed.
  const download = url.searchParams.has('download');
  const banner = await bannerData(deps, post, format, { render: download });
  if (!banner) throw new Response('Nicht gefunden', { status: 404 });
  const { row, data } = banner;
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': 'image/png',
      ...imageCacheHeaders(
        row.sha256,
        url.searchParams.get('b') === String(row.id),
      ),
      ...(download
        ? {
            'content-disposition': `attachment; filename="postomat-${post.id}-${format}.png"`,
          }
        : {}),
    },
  });
}
