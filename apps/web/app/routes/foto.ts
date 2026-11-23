import type { LoaderFunctionArgs } from 'react-router';
import { eq, photos } from '@postomat/db';
import { getPost } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';

/** A member photo (Medienteam or the author). */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const deps = await getDeps();
  const [photo] = await deps.db
    .select()
    .from(photos)
    .where(eq(photos.id, Number(params['id'])));
  if (!photo?.postId) throw new Response('Nicht gefunden', { status: 404 });
  const post = await getPost(deps.db, photo.postId);
  if (
    post.authorUsername !== user.username &&
    !user.roles.includes('medienteam')
  )
    throw new Response('Kein Zugang', { status: 403 });
  return new Response(new Uint8Array(await deps.media.get(photo.path)), {
    headers: {
      'content-type': photo.mime,
      'cache-control': 'private, max-age=300',
    },
  });
}
