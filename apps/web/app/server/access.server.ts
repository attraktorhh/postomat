import type { Post } from '@postomat/db';
import { getPost, isDbId, NotFoundError } from '@postomat/workflow';
import { NOT_YOUR_POST, requireUser, type CurrentUser } from './auth.server';
import { getDeps } from './deps.server';

/**
 * "Author or Medienteam" access to one post, shared by /b/:id, /banner and
 * /foto. Unknown or invalid ids → 404, someone else's post → 403 with reason.
 */
export async function requirePostAccess(
  request: Request,
  rawId: string | number | undefined,
): Promise<{ user: CurrentUser; post: Post; isAuthor: boolean }> {
  const user = await requireUser(request);
  const id = Number(rawId);
  if (!isDbId(id)) throw new Response('Nicht gefunden', { status: 404 });
  const deps = await getDeps();
  const post = await getPost(deps.db, id).catch((e: unknown) => {
    if (e instanceof NotFoundError)
      throw new Response('Beitrag nicht gefunden', { status: 404 });
    throw e;
  });
  const isAuthor = post.authorUsername === user.username;
  if (!isAuthor && !user.roles.includes('medienteam'))
    throw new Response(NOT_YOUR_POST, { status: 403 });
  return { user, post, isAuthor };
}
