import { instagramCaption, renderCard, type MatrixText } from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';
import { getChannels, getPost } from './repo.ts';
import { checksFor } from './posts.ts';
import { draftOf, redaktionUrl } from './context.ts';

const excerpt = (s: string, n = 140) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
};

/** Renders the #medienteam card for a post from the DB. */
export async function buildCard(deps: WorkflowDeps, postId: number): Promise<MatrixText> {
  const post = await getPost(deps.db, postId);
  const channels = await getChannels(deps.db, postId);
  const ig = channels.find((c) => c.channel === 'instagram' && c.mode !== 'off');
  const checks = await checksFor(deps, postId);
  return renderCard({
    title: post.facts.title ?? 'Ohne Titel',
    authorUsername: post.authorUsername,
    version: post.version,
    status: post.status,
    approvedBy: post.approvedBy,
    type: post.type,
    facts: post.facts,
    instagramExcerpt: ig ? excerpt(instagramCaption(draftOf(ig)).split('\n\n')[0]) : undefined,
    channels: channels.map((c) => ({ channel: c.channel, mode: c.mode, status: c.status, url: c.url, error: c.error })),
    note: post.note,
    checks,
    editUrl: redaktionUrl(deps, postId),
  });
}
