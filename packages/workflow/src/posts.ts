import {
  BANNER_COLORS,
  CONSENT_LABELS,
  CONSENTS,
  assertTransition,
  credentialsFromEnv,
  decideApproval,
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
  type Post,
} from '@postomat/db';
import {
  buildDrafts,
  CHANNEL_NAMES,
  dmFollowUp,
  dmRueckfrage,
} from '@postomat/templates';
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
 * (Re)creates the channel posts for a draft: modes from config, texts from
 * templates, optionally AI-written bodies. Only used while collecting
 * (`sammeln`) or on an explicit AI rewrite; Redaktion edits are never overwritten
 * after submission.
 */
export async function generateTexts(
  deps: WorkflowDeps,
  postId: number,
  instruction?: string,
): Promise<{ aiUsed: boolean }> {
  const post = await getPost(deps.db, postId);
  const modes = resolveChannelModes(
    deps.config,
    post.type,
    credentialsFromEnv(deps.env),
  );
  const ctx = templateContext(deps, post);
  let aiUsed = false;
  if (deps.ai) {
    const ai = await deps.ai.writeTexts({
      type: post.type,
      facts: post.facts,
      instruction,
    });
    if (ai) {
      ctx.ai = ai;
      aiUsed = true;
    }
  }
  const drafts = buildDrafts(
    ctx,
    modes.filter((m) => m.mode !== 'off').map((m) => m.channel),
  );
  await deps.db.transaction(async (tx) => {
    for (const { channel, mode } of modes) {
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
      .set({ aiUsed: aiUsed || post.aiUsed, updatedAt: new Date() })
      .where(eq(posts.id, postId));
  });
  return { aiUsed };
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
      await deps.queue.send(
        'publish.channel',
        { postId: input.postId, channel: c.channel as 'wordpress' | 'wiki' },
        { singletonKey: `${input.postId}:${c.channel}` },
      );
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

const EDITABLE: ReadonlySet<string> = new Set([
  'sammeln',
  'zur_freigabe',
  'aenderung_gewuenscht',
]);

/** Redaktion: save a channel text (DE/EN/fields). */
export async function editChannelText(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  input: { textDe?: string; textEn?: string; fields?: Record<string, string> },
  actor: string,
): Promise<void> {
  const post = await getPost(deps.db, postId);
  if (!EDITABLE.has(post.status))
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
  if (!EDITABLE.has(post.status))
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
  if (!EDITABLE.has(post.status))
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
  await updatePost(deps.db, postId, { meetupCategory: category || null });
  await addHistory(
    deps.db,
    postId,
    actor,
    'edited',
    `Meetup-Kategorie: ${category || '–'}`,
  );
  const post = await getPost(deps.db, postId);
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
  const post = await getPost(deps.db, postId);
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

/** Copy helpers: "Link eintragen" (Instagram, Facebook, also Meetup by hand). */
export async function setChannelLink(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  url: string,
  actor: string,
): Promise<void> {
  if (!/^https?:\/\/\S+$/.test(url.trim()))
    throw new WorkflowError(
      'Bitte einen vollständigen Link (https://…) eintragen',
    );
  if (channel === 'meetup') {
    const id = /\/events\/([^/?#]+)/.exec(url)?.[1] ?? url;
    await linkMeetup(
      deps,
      postId,
      { meetupId: id, url: url.trim(), via: 'manual' },
      actor,
    );
    return;
  }
  const c = await getChannel(deps.db, postId, channel);
  if (!c || c.mode !== 'copy')
    throw new WorkflowError(
      'Für diesen Kanal kann kein Link eingetragen werden',
    );
  await updateChannel(deps.db, postId, channel, {
    status: 'erledigt',
    url: url.trim(),
    publishedAt: deps.now(),
  });
  await addHistory(
    deps.db,
    postId,
    actor,
    'linked',
    `${CHANNEL_NAMES[channel]}-Link eingetragen`,
    { url },
  );
  await notifyMemberLink(deps, postId, channel, url.trim());
  await recomputeOverall(deps, postId);
  await deps.queue.send('bot.card', { postId });
}

export async function skipChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: ChannelId,
  actor: string,
): Promise<void> {
  const c = await getChannel(deps.db, postId, channel);
  if (!c || c.mode === 'off') throw new WorkflowError('Kanal ist aus');
  if (c.status === 'veroeffentlicht')
    throw new WorkflowError('Kanal ist schon veröffentlicht');
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

/** "Erneut versuchen" for a failed auto channel. */
export async function retryChannel(
  deps: WorkflowDeps,
  postId: number,
  channel: 'wordpress' | 'wiki',
  actor: string,
): Promise<void> {
  const c = await getChannel(deps.db, postId, channel);
  if (!c || c.status !== 'fehler')
    throw new WorkflowError(
      'Nur fehlgeschlagene Kanäle können erneut versucht werden',
    );
  await updateChannel(deps.db, postId, channel, {
    status: 'wartet',
    error: null,
  });
  await addHistory(
    deps.db,
    postId,
    actor,
    'retry',
    `${CHANNEL_NAMES[channel]}: erneut versuchen`,
  );
  await deps.queue.send(
    'publish.channel',
    { postId, channel },
    { singletonKey: `${postId}:${channel}` },
  );
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

/** Stores the member's answer to a Rückfrage. */
export async function answerQuestion(
  deps: WorkflowDeps,
  postId: number,
  answer: string,
  actor: string,
): Promise<void> {
  await updatePost(deps.db, postId, { pendingQuestion: null });
  await deps.db
    .update(conversations)
    .set({ questionPostId: null })
    .where(eq(conversations.questionPostId, postId));
  await addHistory(deps.db, postId, actor, 'answer', `Antwort: „${answer}“`);
  await deps.queue.send('bot.thread', {
    postId,
    text: `Antwort von @${actor}: „${answer}“`,
  });
}

export { draftOf };
