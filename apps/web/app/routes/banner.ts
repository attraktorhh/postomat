import type { LoaderFunctionArgs } from 'react-router';
import { bannerData, getPost } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';

/** Banner PNG of a post (4x5 or 16x9). `?download=1` → file download ("Bild laden"). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const deps = await getDeps();
  const post = await getPost(deps.db, Number(params['id']));
  if (post.authorUsername !== user.username && !user.roles.includes('medienteam')) throw new Response('Kein Zugang', { status: 403 });
  const format = params['format'] === '16x9' ? '16x9' : '4x5';
  const { data } = await bannerData(deps, post, format);
  const download = new URL(request.url).searchParams.has('download');
  return new Response(new Uint8Array(data), {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=60',
      ...(download ? { 'content-disposition': `attachment; filename="postomat-${post.id}-${format}.png"` } : {}),
    },
  });
}
