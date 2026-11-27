import type { ChannelId } from '@postomat/core';
import type { ChannelPost, Post } from '@postomat/db';
import type { ChannelDraft, Links, TemplateContext } from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';

export function templateContext(
  deps: Pick<WorkflowDeps, 'config' | 'env'>,
  post: Post,
): TemplateContext {
  return {
    type: post.type,
    facts: post.facts,
    config: deps.config,
    defaultDurationMin: deps.env.DEFAULT_EVENT_DURATION_MIN,
  };
}

export const draftOf = (c: ChannelPost): ChannelDraft => ({
  textDe: c.textDe,
  textEn: c.textEn,
  fields: c.fields,
});

/** Links known so far (published or entered). */
export function linksOf(
  channels: ChannelPost[],
): Links & { meetupId?: string | null } {
  const by = (ch: ChannelId) => channels.find((c) => c.channel === ch);
  const meetup = by('meetup');
  return {
    website: by('wordpress')?.url ?? null,
    wiki: by('wiki')?.url ?? null,
    meetup: meetup?.status === 'erledigt' ? meetup.url : null,
    meetupId: meetup?.status === 'erledigt' ? meetup.remoteId : null,
  };
}

export const postUrl = (deps: Pick<WorkflowDeps, 'env'>, id: number) =>
  `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/b/${id}`;
export const redaktionUrl = (deps: Pick<WorkflowDeps, 'env'>, id: number) =>
  `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/redaktion/${id}`;
export const copyHelperUrl = (
  deps: Pick<WorkflowDeps, 'env'>,
  id: number,
  channel: ChannelId = 'meetup',
) => `${deps.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/redaktion/${id}/${channel}`;
