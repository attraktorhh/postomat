import type { LoaderFunctionArgs } from 'react-router';
import { bannerData, getPost, NotFoundError } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';

/** Banner PNG of a post (4x5 or 16x9). `?download=1` → file download ("Bild laden"). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const deps = await getDeps();
  const format = params['format'];
  if (format !== '4x5' && format !== '16x9')
    throw new Response('Nicht gefunden', { status: 404 });
  const post = await getPost(deps.db, Number(params['id'])).catch((e) => {
    if (e instanceof NotFoundError)
      throw new Response('Nicht gefunden', { status: 404 });
    throw e;
  });
  if (
    post.authorUsername !== user.username &&
    !user.roles.includes('medienteam')
  )
    throw new Response('Kein Zugang', { status: 403 });
  const { data } = await bannerData(deps, post, format);
  const download = new URL(request.url).searchParams.has('download');
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=60',
      ...(download
        ? {
            'content-disposition': `attachment; filename="postomat-${post.id}-${format}.png"`,
          }
        : {}),
    },
  });
}
