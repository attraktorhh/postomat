import type { LoaderFunctionArgs } from 'react-router';
import { eq, photos } from '@postomat/db';
import { isDbId } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { requirePostAccess } from '../server/access.server';
import { getDeps } from '../server/deps.server';
import { imageCacheHeaders, notModified } from '../server/http';

/**
 * A member photo (Medienteam or the author). A photo row never changes its
 * file, so the URL (by row id) is immutable.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireUser(request);
  const deps = await getDeps();
  const id = Number(params['id']);
  if (!isDbId(id)) throw new Response('Nicht gefunden', { status: 404 });
  const [photo] = await deps.db.select().from(photos).where(eq(photos.id, id));
  if (!photo?.postId) throw new Response('Nicht gefunden', { status: 404 });
  await requirePostAccess(request, photo.postId);
  if (notModified(request, photo.sha256))
    return new Response(null, { status: 304 });
  return new Response(new Uint8Array(await deps.media.get(photo.path)), {
    headers: {
      'content-type': photo.mime,
      ...imageCacheHeaders(photo.sha256, true),
    },
  });
}
