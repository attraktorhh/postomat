import type { WorkflowDeps } from './deps.ts';
import type { JobQueue } from './queue.ts';
import { publishChannel, updatePublished } from './publish.ts';
import { pollMeetup } from './meetup.ts';
import { renderBanners } from './photos.ts';
import { getPost } from './repo.ts';

/** Registers the worker's job handlers (banner, publish, Meetup poll). */
export async function registerWorkerJobs(deps: WorkflowDeps, queue: JobQueue): Promise<void> {
  await queue.work('banner.render', async ({ postId }) => {
    await renderBanners(deps, await getPost(deps.db, postId));
  });
  await queue.work('publish.channel', async ({ postId, channel }, meta) => publishChannel(deps, postId, channel, meta));
  await queue.work('publish.update', async ({ postId, channel }) => updatePublished(deps, postId, channel));
  await queue.work('meetup.poll', async () => {
    const r = await pollMeetup(deps);
    if (r.checked) deps.log.info('meetup poll', r);
  });
}

export async function scheduleWorkerJobs(deps: WorkflowDeps, queue: JobQueue): Promise<void> {
  const n = Math.max(1, Math.min(59, deps.env.MEETUP_POLL_INTERVAL_MIN));
  await queue.schedule('meetup.poll', `*/${n} * * * *`);
}
