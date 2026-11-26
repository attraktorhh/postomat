import {
  BANNER_COLORS,
  CONSENT_LABELS,
  CONSENTS,
  assertTransition,
  credentialsFromEnv,
  decideApproval,
  isEditable,
  nextVersion,
  overallStatusAfterApproval,
  resolveChannelModes,
  runChecks,
  type ApprovalDecision,
  type BannerColor,
  type ChannelId,
  type Consent,
  type PostFacts,
  type PostType,
} from '@postomat/core';
import {
  and,
  approvals,
  channelPosts,
  conversations,
  eq,
  photos,
  posts,
  type ChannelPost,
  type Post,
} from '@postomat/db';
import {
  buildDrafts,
  CHANNEL_NAMES,
  DM,
  dmFollowUp,
  dmRueckfrage,
} from '@postomat/templates';
import { isAiError } from '@postomat/ai';
import type { WorkflowDeps } from './deps.ts';
import {
  addHistory,
  channelSnapshot,
  getChannel,
  getChannels,
  getPhotos,
  getPost,
  photoSnapshot,
  toSnapshot,
  updateChannel,
  updatePost,
} from './repo.ts';
import { templateContext, draftOf } from './context.ts';
// Circular with meetup.ts on purpose; only used inside functions.
import { linkMeetup } from './meetup.ts';

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/** Creates a draft post for a member (status `sammeln`). */
export async function createDraft(
  deps: WorkflowDeps,
  author: { matrixId: string; username: string; displayName?: string },
  type: PostType,
): Promise<Post> {
  const [row] = await deps.db
    .insert(posts)
    .values({
      type,
      authorMatrixId: author.matrixId,
      authorUsername: author.username,
      authorDisplayName: author.displayName,
      bannerColor: deps.config.banner.defaultColor,
    })
    .returning();
  await addHistory(
    deps.db,
    row.id,
    author.username,
    'created',
    'über Matrix begonnen',
  );
  return row;
}

/**
 * (Re)creates the channel posts: modes from config, AI-written bodies inside
 * the template frame. Throws `AiError` when the AI fails – there are no
 * template-only bodies. `keepEdited` keeps channels the Redaktion edited
 * after the last generation.
 */
export async function generateTexts(
  deps: WorkflowDeps,
  postId: number,
  opts: { instruction?: string; keepEdited?: boolean } = {},
): Promise<void> {
  const post = await getPost(deps.db, postId);
  const modes = resolveChannelModes(
    deps.config,
    post.type,
    credentialsFromEnv(deps.env),
  );
  const existing = await getChannels(deps.db, postId);
  const ai = await deps.ai.writeTexts({
    type: post.type,
    facts: post.facts,
    instruction: opts.instruction,
  });
  const drafts = buildDrafts(
    { ...templateContext(deps, post), ai },
    modes.filter((m) => m.mode !== 'off').map((m) => m.channel),
  );
  const editedByHand = (channel: ChannelId) => {
    if (!opts.keepEdited || !post.textsGeneratedAt) return false;
    const c = existing.find((x) => x.channel === channel);
    return !!c && c.updatedAt > post.textsGeneratedAt;
  };
  await deps.db.transaction(async (tx) => {
    for (const { channel, mode } of modes) {
      if (editedByHand(channel)) continue;
      const d = drafts[channel] ?? { textDe: '', textEn: '', fields: {} };
      await tx
        .insert(channelPosts)
        .values({
          postId,
          channel,
          mode,
          status: mode === 'off' ? 'aus' : 'entwurf',
          ...d,
        })
        .onConflictDoUpdate({
          target: [channelPosts.postId, channelPosts.channel],
          set: {
            mode,
            status: mode === 'off' ? 'aus' : 'entwurf',
            textDe: d.textDe,
            textEn: d.textEn,
            fields: d.fields,
            updatedAt: new Date(),
          },
        });
    }
    await tx
      .update(posts)
      .set({
        aiUsed: true,
        textsError: null,
        textsErrorAt: null,
        textsFacts: post.facts,
        // A tick after the channel rows, so they don't count as edited later.
        textsGeneratedAt: new Date(Date.now() + 1),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId));
  });
}

const sortKeys = (o: object) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(o)
        .filter(([, v]) => v !== undefined)
        .sort(([x], [y]) => x.localeCompare(y)),
    ),
  );

/** True when the facts changed since the AI last wrote the texts. */
export const textsOutdated = (post: Post): boolean =>
  sortKeys(post.textsFacts ?? {}) !== sortKeys(post.facts);

/**
 * Worker job `texts.generate`: writes the texts again. pg-boss retries with
 * backoff; after the last attempt the Redaktion shows the error and the
 * author is told in the DM.
 */
export async function regenerateTextsJob(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
  meta: { isLastAttempt: boolean },
): Promise<void> {
  try {
    await generateTexts(deps, postId, { keepEdited: true });
  } catch (e) {
    if (!isAiError(e) || !meta.isLastAttempt) throw e;
    const post = await getPost(deps.db, postId);
    await updatePost(deps.db, postId, {
      textsError: e.kind,
      textsErrorAt: deps.now(),
    });
    await addHistory(
      deps.db,
      postId,
      'postomat',
      'texts_failed',
      'Texte konnten nicht erstellt werden (KI nicht erreichbar)',
    );
    await deps.queue.send('bot.dm', {
      matrixUserId: post.authorMatrixId,
      text: DM.textsFailed(post.facts.title ?? 'deinen Beitrag'),
    });
    return;
  }
  await addHistory(deps.db, postId, actor, 'edited', 'Texte neu erstellt');
  await deps.queue.send('bot.card', { postId });
}

/** Redaktion: "Texte konnten nicht erstellt werden · Erneut versuchen". */
export async function retryTexts(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  if (!isEditable(post.status))
    throw new WorkflowError('Beitrag kann nicht mehr bearbeitet werden');
  await updatePost(deps.db, postId, { textsError: null, textsErrorAt: null });
  await deps.queue.send('texts.generate', { postId, actor });
}

/** Updates facts while collecting. */
export async function saveFacts(
  deps: WorkflowDeps,
  postId: number,
  facts: PostFacts,
  type?: PostType,
): Promise<void> {
  await updatePost(deps.db, postId, { facts, ...(type ? { type } : {}) });
}

/** sammeln → zur_freigabe (DM "abschicken" or web "Ans Medienteam schicken"). */
export async function submitPost(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
  note?: string,
): Promise<Post> {
  const post = await deps.db.transaction(async (tx) => {
    const p = await getPost(tx, postId, true);
    assertTransition(p.status, 'zur_freigabe');
    if (!(await getChannels(tx, postId)).length)
      throw new WorkflowError('Texte fehlen noch');
    const cleanNote = note?.trim() ? note.trim() : p.note;
    await updatePost(tx, postId, {
      status: 'zur_freigabe',
      submittedAt: deps.now(),
      note: cleanNote ?? null,
    });
    await addHistory(
      tx,
      postId,
      actor,
      'submitted',
      cleanNote && cleanNote !== p.note
        ? 'Notiz ergänzt, abgeschickt'
        : 'eingereicht',
    );
    return getPost(tx, postId);
  });
  await deps.queue.send('bot.card', { postId });
  return post;
}

export interface ApproveInput {
  postId: number;
  approverUsername: string;
  approverIsMedienteam: boolean;
  version: number;
  via: 'matrix' | 'web';
}

/**
 * Approves a post in one transaction with a row lock, so a double 👍 can never
 * publish twice. Enqueues the publish jobs for auto channels.
 */
export async function approvePost(
  deps: WorkflowDeps,
  input: ApproveInput,
): Promise<ApprovalDecision> {
  const decision = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, input.postId, true);
    const channels = await getChannels(tx, post.id);
    const decision = decideApproval({
      post: toSnapshot(post),
      channels: channels.map(channelSnapshot),
      photos: (await getPhotos(tx, post.id)).map(photoSnapshot),
      now: deps.now(),
      approverUsername: input.approverUsername,
      approverIsMedienteam: input.approverIsMedienteam,
      version: input.version,
      meetupCategory: post.meetupCategory,
    });
    if (decision.kind !== 'approve') return decision;
    assertTransition(post.status, 'geplant');
    await updatePost(tx, post.id, {
      status: 'geplant',
      approvedBy: input.approverUsername,
      approvedAt: deps.now(),
    });
    for (const c of channels) {
      // A copy channel that is already done (link entered or skipped) stays done.
      if (
        c.mode === 'copy' &&
        (c.status === 'erledigt' || c.status === 'uebersprungen')
      )
        continue;
      const status =
        c.mode === 'auto' ? 'wartet' : c.mode === 'copy' ? 'kopieren' : 'aus';
      await updateChannel(tx, post.id, c.channel, { status });
    }
    await tx.insert(approvals).values({
      postId: post.id,
      version: post.version,
      actor: input.approverUsername,
      result: 'approved',
    });
    await addHistory(
      tx,
      post.id,
      input.approverUsername,
      'approved',
      `freigegeben (v${post.version}${input.via === 'web' ? ', im Browser' : ''})`,
    );
    return decision;
  });
  if (decision.kind === 'approve') {
    const channels = await getChannels(deps.db, input.postId);
    const auto = channels.filter((c) => c.mode === 'auto');
    for (const c of auto) {
      // If this send is lost (crash right after the commit), the worker's
      // publish.sweep job re-sends it after 10 minutes.
      await deps.queue.send('publish.channel', {
        postId: input.postId,
        channel: c.channel as 'wordpress' | 'wiki',
      });
    }
    await deps.queue.send('bot.card', { postId: input.postId });
    if (!auto.length) await settleAfterPublish(deps, input.postId);
  }
  return decision;
}

/** zur_freigabe → aenderung_gewuenscht (thread reply, ✏️ or web). Extra comments are just logged. */
export async function requestChange(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
  comment?: string,
): Promise<boolean> {
  const changed = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, postId, true);
    const msg = comment
      ? `Änderung gewünscht: „${comment}“`
      : 'Änderung gewünscht';
    if (post.status === 'aenderung_gewuenscht') {
      if (comment)
        await addHistory(
          tx,
          postId,
          actor,
          'comment',
          `Kommentar: „${comment}“`,
        );
      return false;
    }
    if (post.status !== 'zur_freigabe') return false;
    await updatePost(tx, postId, { status: 'aenderung_gewuenscht' });
    await tx.insert(approvals).values({
      postId,
      version: post.version,
      actor,
      result: 'change_requested',
      comment,
    });
    await addHistory(tx, postId, actor, 'change_requested', msg, { comment });
    return true;
  });
  if (changed) await deps.queue.send('bot.card', { postId });
  return changed;
}

/** "Erneut zur Freigabe (vN)": aenderung_gewuenscht → zur_freigabe with version + 1. */
export async function resubmit(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
): Promise<Post> {
  const post = await deps.db.transaction(async (tx) => {
    const p = await getPost(tx, postId, true);
    const version = nextVersion(p.status, 'zur_freigabe', p.version);
    await updatePost(tx, postId, { status: 'zur_freigabe', version });
    await addHistory(
      tx,
      postId,
      actor,
      'resubmitted',
      `erneut zur Freigabe (v${version})`,
    );
    return getPost(tx, postId);
  });
  await deps.queue.send('banner.render', { postId });
  if (textsOutdated(post))
    await deps.queue.send('texts.generate', { postId, actor });
  await deps.queue.send('bot.card', { postId });
  return post;
}

export async function discardPost(
  deps: WorkflowDeps,
  postId: number,
  actor: string,
): Promise<void> {
  const notifyCard = await deps.db.transaction(async (tx) => {
    const p = await getPost(tx, postId, true);
    assertTransition(p.status, 'verworfen');
    await updatePost(tx, postId, { status: 'verworfen' });
    await addHistory(tx, postId, actor, 'discarded', 'verworfen');
    return !!p.cardEventId;
  });
  if (notifyCard) await deps.queue.send('bot.card', { postId });
}

/** Redaktion: save a channel text (DE/EN/fields). */
export async function editChannelText(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  input: { textDe?: string; textEn?: string; fields?: Record<string, string> },
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  if (!isEditable(post.status))
    throw new WorkflowError(
      'Veröffentlichte Beiträge können nicht mehr bearbeitet werden',
    );
  const current = await getChannel(deps.db, postId, channel);
  if (!current) throw new WorkflowError(`Kanal ${channel} fehlt`);
  const next = {
    textDe: input.textDe ?? current.textDe,
    textEn: input.textEn ?? current.textEn,
    fields: { ...current.fields, ...(input.fields ?? {}) },
  };
  if (
    next.textDe === current.textDe &&
    next.textEn === current.textEn &&
    JSON.stringify(next.fields) === JSON.stringify(current.fields)
  )
    return;
  await updateChannel(deps.db, postId, channel, next);
  await addHistory(
    deps.db,
    postId,
    actor,
    'edited',
    `${CHANNEL_NAMES[channel]}-Text bearbeitet`,
    { channel },
  );
  if (post.cardEventId) await deps.queue.send('bot.card', { postId });
}

/** Redaktion: facts that the Medienteam may change (end time, workshop flag, …). */
export async function editFacts(
  deps: WorkflowDeps,
  postId: number,
  patch: PostFacts,
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  if (!isEditable(post.status))
    throw new WorkflowError('Beitrag kann nicht mehr bearbeitet werden');
  if (
    patch.endTime !== undefined &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.endTime)
  )
    throw new WorkflowError('Endzeit bitte als HH:MM angeben, z. B. 21:00');
  await updatePost(deps.db, postId, { facts: { ...post.facts, ...patch } });
  await addHistory(deps.db, postId, actor, 'edited', 'Angaben bearbeitet', {
    patch,
  });
  await deps.queue.send('banner.render', { postId });
  if (post.cardEventId) await deps.queue.send('bot.card', { postId });
}

export async function setBannerColor(
  deps: WorkflowDeps,
  postId: number,
  color: BannerColor,
  actor: string,
): Promise<void> {
  if (!(BANNER_COLORS as readonly string[]).includes(color))
    throw new WorkflowError(`Unbekannte Banner-Farbe ${color}`);
  const post = await getPost(deps.db, postId);
  if (!isEditable(post.status))
    throw new WorkflowError('Beitrag kann nicht mehr bearbeitet werden');
  await updatePost(deps.db, postId, { bannerColor: color });
  await addHistory(deps.db, postId, actor, 'edited', `Banner-Farbe: ${color}`);
  await deps.queue.send('banner.render', { postId });
}

export async function setMeetupCategory(
  deps: WorkflowDeps,
  postId: number,
  category: string,
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  // After approval only while the Meetup event still has to be created by hand.
  const meetup = await getChannel(deps.db, postId, 'meetup');
  if (!isEditable(post.status) && meetup?.status !== 'kopieren')
    throw new WorkflowError(
      'Die Meetup-Kategorie kann nicht mehr geändert werden',
    );
  await updatePost(deps.db, postId, { meetupCategory: category || null });
  await addHistory(
    deps.db,
    postId,
    actor,
    'edited',
    `Meetup-Kategorie: ${category || '–'}`,
  );
  if (post.cardEventId) await deps.queue.send('bot.card', { postId });
}

export async function setPhotoConsent(
  deps: WorkflowDeps,
  postId: number,
  photoId: number,
  consent: Consent,
  actor: string,
): Promise<void> {
  if (!(CONSENTS as readonly string[]).includes(consent))
    throw new WorkflowError(`Unbekannte Einwilligung ${consent}`);
  const post = await getPost(deps.db, postId);
  // After approval the photo may already be published: consent is fixed then.
  if (!isEditable(post.status))
    throw new WorkflowError(
      'Nach der Freigabe kann die Einwilligung nicht mehr geändert werden',
    );
  await deps.db
    .update(photos)
    .set({ consent })
    .where(and(eq(photos.id, photoId), eq(photos.postId, postId)));
  await addHistory(
    deps.db,
    postId,
    actor,
    'edited',
    `Foto-Einwilligung: ${CONSENT_LABELS[consent]}`,
  );
  if (post.cardEventId) await deps.queue.send('bot.card', { postId });
}

/** Current checks for display. */
export async function checksFor(
  deps: WorkflowDeps,
  postId: number,
  approverUsername?: string,
) {
  const post = await getPost(deps.db, postId);
  return runChecks({
    post: toSnapshot(post),
    channels: (await getChannels(deps.db, postId)).map(channelSnapshot),
    photos: (await getPhotos(deps.db, postId)).map(photoSnapshot),
    now: deps.now(),
    approverUsername,
    meetupCategory: post.meetupCategory,
  });
}

/** Moves `geplant` → `online` once every channel is done. */
export async function recomputeOverall(
  deps: WorkflowDeps,
  postId: number,
): Promise<void> {
  const becameOnline = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, postId, true);
    if (post.status !== 'geplant') return false;
    const channels = await getChannels(tx, postId);
    if (overallStatusAfterApproval(channels) !== 'online') return false;
    await updatePost(tx, postId, { status: 'online' });
    await addHistory(
      tx,
      postId,
      'postomat',
      'online',
      'alle Kanäle erledigt – online',
    );
    return true;
  });
  if (becameOnline) await deps.queue.send('bot.card', { postId });
}

/**
 * Called whenever an auto channel finished (success or final failure). Once
 * all auto channels are settled, the approval summary and the member DM go out
 * exactly once.
 */
export async function settleAfterPublish(
  deps: WorkflowDeps,
  postId: number,
): Promise<void> {
  const fire = await deps.db.transaction(async (tx) => {
    const post = await getPost(tx, postId, true);
    if (post.autoNotifiedAt) return false;
    const channels = await getChannels(tx, postId);
    if (
      channels.some(
        (c) =>
          c.mode === 'auto' &&
          (c.status === 'wartet' || c.status === 'entwurf'),
      )
    )
      return false;
    await updatePost(tx, postId, { autoNotifiedAt: deps.now() });
    return true;
  });
  if (fire) await deps.queue.send('bot.after-publish', { postId });
  await recomputeOverall(deps, postId);
  await deps.queue.send('bot.card', { postId });
}

/** Links and skips are for approved posts only: before, nothing may be posted. */
async function approvedCopyChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
): Promise<ChannelPost> {
  const post = await getPost(deps.db, postId);
  if (post.status !== 'geplant' && post.status !== 'online')
    throw new WorkflowError('Das geht erst, wenn der Beitrag freigegeben ist');
  const c = await getChannel(deps.db, postId, channel);
  if (!c || c.mode === 'off')
    throw new WorkflowError(
      `${CHANNEL_NAMES[channel]} ist für diesen Beitrag aus`,
    );
  if (c.mode !== 'copy')
    throw new WorkflowError(
      `${CHANNEL_NAMES[channel]} wird automatisch veröffentlicht`,
    );
  return c;
}

/**
 * Copy helpers: "Link eintragen" for every copy channel (Meetup, Instagram,
 * Facebook, and Website/Wiki when they fell back to copy mode). Throws a
 * WorkflowError with a German message when the link can't be stored.
 */
export async function setChannelLink(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  url: string,
  actor: string,
): Promise<void> {
  const link = url.trim();
  if (!/^https?:\/\/\S+$/.test(link))
    throw new WorkflowError(
      'Bitte einen vollständigen Link (https://…) eintragen',
    );
  if (channel === 'meetup') {
    // The id goes into the wiki template (meetupid=…), so it must be numeric.
    const id = /\/events\/(\d+)(?:[/?#]|$)/.exec(link)?.[1];
    if (!id || !/^https:\/\/(www\.)?meetup\.com\//.test(link))
      throw new WorkflowError(
        'Bitte den Link zum Meetup-Event eintragen, z. B. https://www.meetup.com/attraktor/events/123456789/',
      );
    await linkMeetup(
      deps,
      postId,
      { meetupId: id, url: link, via: 'manual' },
      actor,
    );
    return;
  }
  const c = await approvedCopyChannel(deps, postId, channel);
  if (c.status === 'erledigt' && c.url === link) return;
  await updateChannel(deps.db, postId, channel, {
    status: 'erledigt',
    url: link,
    publishedAt: deps.now(),
  });
  await addHistory(
    deps.db,
    postId,
    actor,
    'linked',
    `${CHANNEL_NAMES[channel]}-Link ${c.status === 'erledigt' ? 'geändert' : 'eingetragen'}`,
    { url: link },
  );
  await notifyMemberLink(deps, postId, channel, link);
  await recomputeOverall(deps, postId);
  await deps.queue.send('bot.card', { postId });
}

/** "Überspringen": only copy channels; auto channels must really be published. */
export async function skipChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  actor: string,
): Promise<void> {
  const c = await approvedCopyChannel(deps, postId, channel);
  if (c.status === 'uebersprungen') return;
  if (c.status === 'erledigt')
    throw new WorkflowError(
      `${CHANNEL_NAMES[channel]} ist schon erledigt (Link eingetragen)`,
    );
  await updateChannel(deps.db, postId, channel, { status: 'uebersprungen' });
  await addHistory(
    deps.db,
    postId,
    actor,
    'skipped',
    `${CHANNEL_NAMES[channel]} übersprungen`,
  );
  await recomputeOverall(deps, postId);
  await deps.queue.send('bot.card', { postId });
}

/** A `wartet` channel without a job holding it for this long counts as stuck. */
const STALE_WAIT_MS = 10 * 60_000;

/** True when an auto channel waits but no job has touched it for 10 minutes. */
export function isStuckWaiting(c: ChannelPost, now = new Date()): boolean {
  return (
    c.status === 'wartet' &&
    now.getTime() - c.updatedAt.getTime() > STALE_WAIT_MS &&
    (!c.claimedUntil || c.claimedUntil.getTime() < now.getTime())
  );
}

/** "Erneut versuchen" for a failed (or stuck waiting) auto channel. */
export async function retryChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: 'wordpress' | 'wiki',
  actor: string,
): Promise<void> {
  const c = await getChannel(deps.db, postId, channel);
  if (!c || (c.status !== 'fehler' && !isStuckWaiting(c)))
    throw new WorkflowError(
      'Nur fehlgeschlagene Kanäle können erneut versucht werden',
    );
  await updateChannel(deps.db, postId, channel, {
    status: 'wartet',
    error: null,
    claimedUntil: null,
  });
  await addHistory(
    deps.db,
    postId,
    actor,
    'retry',
    `${CHANNEL_NAMES[channel]}: erneut versuchen`,
  );
  await deps.queue.send('publish.channel', { postId, channel });
}

/** Follow-up DM for a link that arrives after the main "ist online" DM. */
export async function notifyMemberLink(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  url: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  if (!post.autoNotifiedAt) return; // will be part of the main DM
  await deps.queue.send('bot.dm', {
    matrixUserId: post.authorMatrixId,
    text: dmFollowUp(post.facts.title ?? 'Beitrag', channel, url),
  });
}

/** "Rückfrage ans Mitglied": the bot asks the author; the next DM reply goes to the history. */
export async function askMember(
  deps: WorkflowDeps,
  postId: number,
  question: string,
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  await updatePost(deps.db, postId, { pendingQuestion: question });
  await deps.db
    .insert(conversations)
    .values({ matrixUserId: post.authorMatrixId, questionPostId: postId })
    .onConflictDoUpdate({
      target: conversations.matrixUserId,
      set: { questionPostId: postId, updatedAt: new Date() },
    });
  await addHistory(
    deps.db,
    postId,
    actor,
    'question',
    `Rückfrage: „${question}“`,
  );
  await deps.queue.send('bot.dm', {
    matrixUserId: post.authorMatrixId,
    text: dmRueckfrage(post.facts.title ?? 'deinem Beitrag', question, actor),
  });
}

/**
 * Stores the member's answer to a Rückfrage verbatim. Facts the AI read from
 * it are offered to the Redaktion as suggestions, never applied directly.
 */
export async function answerQuestion(
  deps: WorkflowDeps,
  postId: number,
  answer: string,
  actor: string,
  suggested: PostFacts = {},
): Promise<void> {
  const post = await getPost(deps.db, postId);
  const changes = Object.fromEntries(
    Object.entries(suggested).filter(
      ([k, v]) => v !== undefined && post.facts[k as keyof PostFacts] !== v,
    ),
  ) as PostFacts;
  const hasSuggestions =
    isEditable(post.status) && Object.keys(changes).length > 0;
  await updatePost(deps.db, postId, {
    pendingQuestion: null,
    ...(hasSuggestions
      ? { suggestedFacts: { ...(post.suggestedFacts ?? {}), ...changes } }
      : {}),
  });
  await deps.db
    .update(conversations)
    .set({ questionPostId: null })
    .where(eq(conversations.questionPostId, postId));
  await addHistory(
    deps.db,
    postId,
    actor,
    'answer',
    `Antwort: „${answer}“`,
    hasSuggestions ? { suggestedFacts: changes } : {},
  );
  await deps.queue.send('bot.thread', {
    postId,
    text: `Antwort von @${actor}: „${answer}“`,
  });
}

/** Redaktion: applies or dismisses the facts suggested by a Rückfrage answer. */
export async function resolveSuggestedFacts(
  deps: WorkflowDeps,
  postId: number,
  apply: boolean,
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  const suggested = post.suggestedFacts;
  if (!suggested) return;
  await updatePost(deps.db, postId, { suggestedFacts: null });
  if (apply) await editFacts(deps, postId, suggested, actor);
  else
    await addHistory(
      deps.db,
      postId,
      actor,
      'edited',
      'Vorgeschlagene Änderungen verworfen',
    );
}

export { draftOf };
