import {
  advanceDialog,
  initialDialogState,
  interpretContext,
  openQuestion,
  validateAiFacts,
  type DialogEffect,
  type DialogInput,
  type DialogState,
  type Interpretation,
  type MatrixIncoming,
  type MatrixPort,
  type PendingConfirmation,
} from '@postomat/core';
import { isAiError } from '@postomat/ai';
import {
  and,
  conversations,
  desc,
  eq,
  posts,
  processedEvents,
  settings,
  type Conversation,
  type Post,
} from '@postomat/db';
import {
  approvedSummary,
  CHANNEL_NAMES,
  dmGreeting,
  dmPublished,
  dmStatus,
  dmSummary,
  DM,
  DM_SUBMIT_HINT,
  instagramExcerpt,
  THREAD,
} from '@postomat/templates';
import type { WorkflowDeps } from './deps.ts';
import type { JobQueue } from './queue.ts';
import { getRoomSettings, Membership } from './membership.ts';
import {
  addHistory,
  getChannels,
  getPost,
  localpart,
  updatePost,
} from './repo.ts';
import {
  answerQuestion,
  approvePost,
  createDraft,
  discardPost,
  generateTexts,
  requestChange,
  submitPost,
} from './posts.ts';
import {
  bannerData,
  renderBanners,
  setConsent,
  storeMemberPhoto,
  UnsupportedImageError,
} from './photos.ts';
import { answerMeetupQuestion } from './meetup.ts';
import { buildCard } from './card.ts';
import { copyHelperUrl, draftOf, postUrl } from './context.ts';

const isThumbsUp = (key: string) => key.startsWith('👍');
const isPencil = (key: string) => key.startsWith('✏') || key.startsWith('📝');

export type BotDeps = WorkflowDeps & { matrix: MatrixPort };

/** Photos larger than this are refused before downloading. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Matrix-facing behaviour of Postomat. `apps/bot` feeds it events. */
export class BotService {
  readonly membership: Membership;
  private readonly deps: BotDeps;

  constructor(deps: BotDeps) {
    this.deps = deps;
    this.membership = new Membership(deps, deps.matrix);
  }

  private get matrix(): MatrixPort {
    return this.deps.matrix;
  }

  /** Records the event id; false if it was seen before. */
  private async firstTime(eventId: string): Promise<boolean> {
    const rows = await this.deps.db
      .insert(processedEvents)
      .values({ eventId })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  /** Pending work per sender, so one member's events run one after another. */
  private readonly chains = new Map<string, Promise<void>>();
  /** roomId → is it a 1:1 room with the bot (cached like membership). */
  private readonly dmRooms = new Map<string, { at: number; dm: boolean }>();

  /**
   * Handles one event. matrix-bot-sdk does not wait for async listeners, so
   * events of the same sender (several photos from a multi-select, quick
   * messages) are queued here and processed in order; different senders run
   * in parallel.
   */
  handle(evt: MatrixIncoming): Promise<void> {
    const key = evt.kind === 'invite' ? `invite:${evt.roomId}` : evt.sender;
    const next = (this.chains.get(key) ?? Promise.resolve()).then(() =>
      this.process(evt),
    );
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    return next;
  }

  private async isDmRoom(roomId: string): Promise<boolean> {
    const ttl = this.deps.env.MATRIX_MEMBERSHIP_CACHE_SEC * 1000;
    const now = this.deps.now().getTime();
    const hit = this.dmRooms.get(roomId);
    if (hit && now - hit.at < ttl) return hit.dm;
    const members = await this.matrix.getJoinedMembers(roomId);
    const dm = members.length <= 2;
    this.dmRooms.set(roomId, { at: now, dm });
    return dm;
  }

  private async process(evt: MatrixIncoming): Promise<void> {
    if (evt.sender === this.matrix.userId) return;
    try {
      if (evt.kind === 'invite')
        return await this.onInvite(evt.roomId, evt.sender);
      if (!(await this.firstTime(evt.eventId))) return;
      const medienteamRoom = await this.membership.medienteamRoomId();
      if (evt.roomId === medienteamRoom) {
        if (evt.kind === 'reaction') return await this.onReaction(evt);
        if (evt.kind === 'message' && evt.threadRoot)
          return await this.onThreadReply(evt);
        return;
      }
      if (evt.kind !== 'message') return;
      if ((await this.membership.configuredRoomIds()).includes(evt.roomId))
        return;
      if (!(await this.isDmRoom(evt.roomId))) return; // only direct messages
      await this.onDm(evt);
    } catch (e) {
      this.deps.log.error('event handling failed', {
        error: e instanceof Error ? e.stack : String(e),
        event: evt.kind,
      });
    }
  }

  private async onInvite(roomId: string, inviter: string): Promise<void> {
    const configured = await this.membership.configuredRoomIds();
    const settings = await getRoomSettings(this.deps);
    const named = [...settings.memberRooms, settings.medienteamRoom].filter(
      Boolean,
    ) as string[];
    if (
      configured.includes(roomId) ||
      named.includes(roomId) ||
      (await this.membership.isMember(inviter))
    ) {
      await this.matrix.joinRoom(roomId);
      this.membership.invalidate();
      await this.publishRoomDirectory().catch(() => undefined);
      this.deps.log.info('joined room after invite', { roomId, inviter });
    } else {
      this.deps.log.info('ignored invite from non-member', { roomId, inviter });
    }
  }

  // ---------------- DM ----------------

  private async conversation(
    userId: string,
    roomId: string,
  ): Promise<Conversation> {
    const [row] = await this.deps.db
      .insert(conversations)
      .values({ matrixUserId: userId, dmRoomId: roomId })
      .onConflictDoUpdate({
        target: conversations.matrixUserId,
        set: { dmRoomId: roomId, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  private async draftOf(userId: string): Promise<Post | undefined> {
    const [row] = await this.deps.db
      .select()
      .from(posts)
      .where(and(eq(posts.authorMatrixId, userId), eq(posts.status, 'sammeln')))
      .limit(1);
    return row;
  }

  private async saveConversation(
    userId: string,
    values: Partial<typeof conversations.$inferInsert>,
  ): Promise<void> {
    await this.deps.db
      .update(conversations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(conversations.matrixUserId, userId));
  }

  private say(roomId: string, text: string, html?: string) {
    return this.matrix.sendText(roomId, text, html);
  }

  private async onDm(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
  ): Promise<void> {
    const { sender, roomId } = evt;
    if (!(await this.membership.isMember(sender))) {
      await this.say(roomId, DM.notMember);
      return;
    }
    const conv = await this.conversation(sender, roomId);
    const isImage =
      evt.msgtype === 'm.image' ||
      (evt.msgtype === 'm.file' &&
        String(
          (evt.content['info'] as { mimetype?: string } | undefined)
            ?.mimetype ?? '',
        ).startsWith('image/'));
    if (isImage) return this.onPhoto(evt, conv);
    if (['m.file', 'm.video', 'm.audio'].includes(evt.msgtype ?? '')) {
      // e.g. a PDF: answer instead of staying silent
      await this.say(roomId, DM.photoUnsupported);
      return;
    }
    if (evt.msgtype !== 'm.text' && evt.msgtype !== 'm.notice') return;

    const text = evt.body.trim();
    if (!text) return;
    await this.onText(evt, conv, text);
  }

  /** Dialog state for the member's current draft (fresh when there is none). */
  private stateFor(draft: Post | undefined, conv: Conversation): DialogState {
    if (draft && conv.state && conv.postId === draft.id) return conv.state;
    if (draft)
      // Draft without conversation state (e.g. after a restart): continue collecting.
      return {
        ...initialDialogState(),
        step: 'collect',
        type: draft.type,
        facts: draft.facts,
      };
    return initialDialogState();
  }

  /** Runs `fn` while showing "Postomat schreibt …". */
  private async typing<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    await this.matrix.setTyping(roomId, true).catch(() => undefined);
    try {
      return await fn();
    } finally {
      await this.matrix.setTyping(roomId, false).catch(() => undefined);
    }
  }

  private confirmationText(pending: PendingConfirmation, draft: Post): string {
    const title = draft.facts.title ?? 'ohne Titel';
    return pending === 'cancel'
      ? DM.confirmCancel(title)
      : DM.confirmNew(title);
  }

  /**
   * Every chat message goes through the AI first; its intent decides what
   * happens. On an AI failure nothing changes and the member is asked to
   * send the message again.
   */
  private async onText(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    conv: Conversation,
    text: string,
  ): Promise<void> {
    const { sender, roomId } = evt;
    const deps = this.deps;
    const draft = await this.draftOf(sender);
    let state = this.stateFor(draft, conv);
    const rueckfrage = conv.questionPostId
      ? (await getPost(deps.db, conv.questionPostId)).pendingQuestion
      : null;
    const pending =
      draft && state.pendingConfirmation
        ? this.confirmationText(state.pendingConfirmation, draft)
        : null;

    let interp: Interpretation;
    try {
      interp = await this.typing(roomId, () =>
        deps.ai.interpret({
          text,
          context: interpretContext(state, {
            openRueckfrage: rueckfrage,
            pendingConfirmation: pending,
          }),
          now: deps.now(),
        }),
      );
    } catch (e) {
      if (!isAiError(e)) throw e;
      await this.say(roomId, DM.aiUnavailable);
      return;
    }

    if (draft && state.pendingConfirmation) {
      // Repeating the command ("weg damit" again after "verwerfen?") is a yes.
      const repeated =
        (state.pendingConfirmation === 'cancel' &&
          interp.intent === 'cmd_cancel') ||
        (state.pendingConfirmation === 'new' && interp.intent === 'cmd_new');
      if (interp.intent === 'confirm_yes' || repeated)
        return this.confirmed(evt, draft, state.pendingConfirmation);
      // Any other answer keeps the draft.
      state = { ...state, pendingConfirmation: null };
      await this.saveConversation(sender, { state, postId: draft.id });
      if (interp.intent === 'confirm_no') {
        const open = openQuestion(state);
        await this.say(roomId, [DM.keepGoing, open].filter(Boolean).join('\n'));
        return;
      }
    }

    switch (interp.intent) {
      case 'cmd_help':
        await this.say(roomId, DM.help);
        return;
      case 'cmd_status':
        return this.sendStatus(sender, roomId);
      case 'cmd_cancel':
        if (!draft) {
          await this.say(roomId, DM.nothingToCancel);
          return;
        }
        return this.askConfirmation(sender, roomId, draft, state, 'cancel');
      case 'cmd_new':
        if (draft)
          return this.askConfirmation(sender, roomId, draft, state, 'new');
        await this.saveConversation(sender, {
          state: initialDialogState(),
          postId: null,
        });
        await this.say(roomId, dmGreeting(await this.nameOf(sender)));
        return;
      case 'confirm_submit':
        return this.submitFromDm(evt, conv, draft, state);
      case 'answer_rueckfrage':
        if (conv.questionPostId) {
          const question = await getPost(deps.db, conv.questionPostId);
          const suggested = validateAiFacts(interp.facts, {
            now: deps.now(),
            type: question.type,
            known: question.facts,
          }).facts;
          // The answer is stored verbatim; the AI only classified it.
          await answerQuestion(
            deps,
            conv.questionPostId,
            text,
            localpart(sender),
            suggested,
          );
          await this.say(roomId, DM.rueckfrageAck);
          return;
        }
        break;
      default:
        break;
    }
    await this.runDialog(evt, conv, draft, state, {
      kind: 'message',
      interpretation: interp,
    });
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.matrix.getDisplayName(userId)) ?? localpart(userId);
  }

  private async sendStatus(sender: string, roomId: string): Promise<void> {
    const rows = await this.deps.db
      .select()
      .from(posts)
      .where(eq(posts.authorMatrixId, sender))
      .orderBy(desc(posts.createdAt))
      .limit(10);
    await this.say(
      roomId,
      dmStatus(
        rows.map((p) => ({
          id: p.id,
          title: p.facts.title ?? 'Ohne Titel',
          status: p.status,
          url: postUrl(this.deps, p.id),
        })),
      ),
    );
  }

  private async askConfirmation(
    sender: string,
    roomId: string,
    draft: Post,
    state: DialogState,
    pending: PendingConfirmation,
  ): Promise<void> {
    await this.saveConversation(sender, {
      state: { ...state, pendingConfirmation: pending },
      postId: draft.id,
    });
    await this.say(roomId, this.confirmationText(pending, draft));
  }

  /** "ja" to "Entwurf verwerfen?" (cancel, or new while a draft exists). */
  private async confirmed(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    draft: Post,
    pending: PendingConfirmation,
  ): Promise<void> {
    const { sender, roomId } = evt;
    await discardPost(this.deps, draft.id, localpart(sender));
    if (pending === 'cancel') {
      await this.saveConversation(sender, { state: null, postId: null });
      await this.say(roomId, DM.cancelled);
      return;
    }
    await this.saveConversation(sender, {
      state: initialDialogState(),
      postId: null,
    });
    await this.say(roomId, dmGreeting(await this.nameOf(sender)));
  }

  private async submitFromDm(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    conv: Conversation,
    draft: Post | undefined,
    state: DialogState,
  ): Promise<void> {
    const { sender, roomId } = evt;
    if (!draft) {
      await this.say(roomId, DM.nothingToSubmit);
      return;
    }
    if (state.summaryPending) {
      // The texts are still missing: try again instead of submitting.
      return this.runDialog(evt, conv, draft, state, {
        kind: 'effects',
        effects: [{ kind: 'summary' }],
      });
    }
    // A photo sent after the summary opens the consent question again;
    // without the answer the photo would block approval.
    if (state.step !== 'review' || state.expecting === 'consent') {
      const open = openQuestion(state);
      await this.say(
        roomId,
        open
          ? `${DM.notReady}\n${open}`
          : `${DM.notReady} Antworte bitte noch auf meine letzte Frage.`,
      );
      return;
    }
    await submitPost(this.deps, draft.id, localpart(sender));
    await this.saveConversation(sender, { state: null, postId: null });
    await this.say(roomId, DM.submitted);
  }

  private async onPhoto(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    conv: Conversation,
  ): Promise<void> {
    const draft = await this.draftOf(evt.sender);
    if (!draft) {
      await this.say(evt.roomId, DM.photoWithoutDraft);
      return;
    }
    const size = Number(
      (evt.content['info'] as { size?: unknown } | undefined)?.size ?? 0,
    );
    if (size > MAX_PHOTO_BYTES) {
      await this.say(evt.roomId, DM.photoTooLarge);
      return;
    }
    let photoId: number;
    try {
      const data = await this.matrix.downloadMedia(evt.content);
      photoId = (await storeMemberPhoto(this.deps, draft, data, evt.sender)).id;
    } catch (e) {
      if (e instanceof UnsupportedImageError) {
        await this.say(evt.roomId, DM.photoUnsupported);
        return;
      }
      this.deps.log.error('photo upload failed', {
        error: e instanceof Error ? e.message : String(e),
      });
      await this.say(evt.roomId, DM.photoFailed);
      return;
    }
    await addHistory(
      this.deps.db,
      draft.id,
      localpart(evt.sender),
      'photo',
      'Foto hochgeladen',
    );
    await this.runDialog(evt, conv, draft, this.stateFor(draft, conv), {
      kind: 'photo',
      photoId,
    });
  }

  private async runDialog(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    _conv: Conversation,
    existingDraft: Post | undefined,
    current: DialogState,
    input: DialogInput | { kind: 'effects'; effects: DialogEffect[] },
  ): Promise<void> {
    const { sender, roomId } = evt;
    const deps = this.deps;
    let draft = existingDraft;
    const result =
      input.kind === 'effects'
        ? { state: current, replies: [], effects: input.effects }
        : advanceDialog(current, input, {
            now: deps.now(),
            displayName: await this.nameOf(sender),
          });
    let state = result.state;

    if (!draft && state.step !== 'idle') {
      draft = await createDraft(
        deps,
        {
          matrixId: sender,
          username: localpart(sender),
          displayName: await this.nameOf(sender),
        },
        state.type ?? 'event',
      );
    }
    if (draft) {
      await updatePost(deps.db, draft.id, {
        facts: state.facts,
        ...(state.type ? { type: state.type } : {}),
      });
    }
    await this.saveConversation(sender, { state, postId: draft?.id ?? null });

    for (const effect of result.effects) {
      if (!draft) break;
      if (effect.kind === 'set_consent')
        await setConsent(deps, effect.photoIds, effect.consent);
      if (effect.kind === 'note' && evt.body.trim()) {
        // Stored verbatim: the AI only decided that it is a note.
        const text = evt.body.trim();
        const post = await getPost(deps.db, draft.id);
        const note = [post.note, text].filter(Boolean).join('\n');
        await updatePost(deps.db, draft.id, { note });
        await addHistory(
          deps.db,
          draft.id,
          localpart(sender),
          'note',
          `Hinweis: „${text}“`,
        );
      }
    }
    for (const r of result.replies) await this.say(roomId, r);

    for (const effect of result.effects) {
      if (!draft) break;
      try {
        if (effect.kind === 'summary') {
          await this.typing(roomId, () => generateTexts(deps, draft!.id));
          if (state.summaryPending) {
            state = { ...state, summaryPending: false };
            await this.saveConversation(sender, { state });
          }
          await this.sendSummary(roomId, draft.id);
        }
        if (effect.kind === 'change_request') {
          const instruction = effect.instruction || evt.body.trim();
          await this.typing(roomId, () =>
            generateTexts(deps, draft!.id, { instruction }),
          );
          await addHistory(
            deps.db,
            draft.id,
            localpart(sender),
            'edited',
            `Text ändern: „${evt.body.trim()}“`,
          );
          await this.sendSummary(roomId, draft.id, DM.textsUpdated);
        }
      } catch (e) {
        if (!isAiError(e)) throw e;
        if (effect.kind === 'summary' && !state.summaryPending) {
          state = { ...state, summaryPending: true };
          await this.saveConversation(sender, { state });
        }
        await this.say(roomId, DM.aiUnavailable);
        return;
      }
    }
  }

  /**
   * "Super, so schicke ich es ans Medienteam:" + banner + hint. The caller
   * has just written the texts with the AI.
   */
  private async sendSummary(
    roomId: string,
    postId: number,
    hint: string = DM_SUBMIT_HINT,
  ): Promise<void> {
    const post = await getPost(this.deps.db, postId);
    const channels = await getChannels(this.deps.db, postId);
    // Facts (title, date) may have changed while collecting: render afresh.
    const banner4x5 = (await renderBanners(this.deps, post))['4x5'];
    const ig = channels.find(
      (c) => c.channel === 'instagram' && c.mode !== 'off',
    );
    const excerpt = ig ? instagramExcerpt(draftOf(ig), 160) : undefined;
    const msg = dmSummary({
      type: post.type,
      facts: post.facts,
      channels: channels.map((c) => ({ channel: c.channel, mode: c.mode })),
      url: postUrl(this.deps, postId),
      excerpt: excerpt || undefined,
    });
    await this.matrix.sendText(roomId, msg.body, msg.html);
    const banner = banner4x5;
    await this.matrix.sendImage(roomId, {
      data: await this.deps.media.get(banner.path),
      mime: 'image/png',
      name: `banner-${postId}.png`,
      width: banner.width ?? undefined,
      height: banner.height ?? undefined,
    });
    await this.say(roomId, hint);
  }

  // ---------------- #medienteam ----------------

  private async postByCard(eventId: string): Promise<Post | undefined> {
    const [row] = await this.deps.db
      .select()
      .from(posts)
      .where(eq(posts.cardEventId, eventId))
      .limit(1);
    return row;
  }

  private thread(post: Post, text: string) {
    return this.matrix.sendText(post.cardRoomId!, text, undefined, {
      threadRoot: post.cardEventId!,
    });
  }

  private async onReaction(
    evt: Extract<MatrixIncoming, { kind: 'reaction' }>,
  ): Promise<void> {
    const post = await this.postByCard(evt.relatesTo);
    if (!post) return;
    const actor = localpart(evt.sender);
    if (isPencil(evt.key)) {
      if (
        (await this.membership.isMedienteam(evt.sender)) &&
        (await requestChange(this.deps, post.id, actor))
      )
        await this.thread(post, THREAD.changeRequested(actor));
      return;
    }
    if (!isThumbsUp(evt.key)) return;
    const decision = await approvePost(this.deps, {
      postId: post.id,
      approverUsername: actor,
      approverIsMedienteam: await this.membership.isMedienteam(evt.sender),
      version: post.version,
      via: 'matrix',
    });
    switch (decision.kind) {
      case 'self_approval':
        await this.thread(post, THREAD.selfApproval);
        break;
      case 'outdated_version':
        await this.thread(post, THREAD.outdated);
        break;
      case 'blocked':
        await this.thread(
          post,
          THREAD.blocked(decision.failures.map((f) => f.label)),
        );
        break;
      default:
        break; // approve: card job updates; not_medienteam / wrong_state: ignored
    }
  }

  private async onThreadReply(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
  ): Promise<void> {
    const post = await this.postByCard(evt.threadRoot!);
    if (!post) return;
    const actor = localpart(evt.sender);
    if (!(await this.membership.isMedienteam(evt.sender))) return;
    // An open Meetup candidate question: the AI reads the reply first.
    const meetup = await answerMeetupQuestion(
      this.deps,
      post.id,
      evt.body,
      actor,
    );
    if (meetup === 'handled') return;
    if (
      post.status === 'zur_freigabe' ||
      post.status === 'aenderung_gewuenscht'
    ) {
      if (await requestChange(this.deps, post.id, actor, evt.body.trim()))
        await this.thread(post, THREAD.changeRequested(actor));
    } else {
      await addHistory(
        this.deps.db,
        post.id,
        actor,
        'comment',
        `Kommentar: „${evt.body.trim()}“`,
      );
    }
  }

  // ---------------- jobs ----------------

  private matrixIdOf(username: string): string {
    return `@${username}:${this.matrix.userId.split(':').slice(1).join(':')}`;
  }

  /** Sends the card once and edits it in place afterwards. */
  async syncCard(postId: number): Promise<void> {
    const post = await getPost(this.deps.db, postId);
    if (post.status === 'sammeln') return;
    const roomId =
      post.cardRoomId ?? (await this.membership.medienteamRoomId());
    if (!roomId) {
      // Throw so the job is retried (the room may be configured or resolvable later).
      throw new Error(
        `no Medienteam room configured or resolvable – card for post ${postId} not sent`,
      );
    }
    const card = await buildCard(this.deps, postId);
    if (!post.cardEventId) {
      if (post.status === 'verworfen') return;
      const eventId = await this.matrix.sendText(roomId, card.body, card.html);
      await updatePost(this.deps.db, postId, {
        cardRoomId: roomId,
        cardEventId: eventId,
      });
      post.cardRoomId = roomId;
      post.cardEventId = eventId;
    } else {
      await this.matrix.sendText(roomId, card.body, card.html, {
        replaces: post.cardEventId,
      });
    }
    if (
      post.status === 'zur_freigabe' &&
      post.cardBannerVersion !== post.version
    ) {
      const { row, data } = await bannerData(this.deps, post, '4x5');
      if (post.version > 1)
        await this.thread(post, THREAD.newVersion(post.version));
      await this.matrix.sendImage(
        roomId,
        {
          data,
          mime: 'image/png',
          name: `banner-v${post.version}.png`,
          width: row.width ?? undefined,
          height: row.height ?? undefined,
        },
        { threadRoot: post.cardEventId },
      );
      await updatePost(this.deps.db, postId, {
        cardBannerVersion: post.version,
      });
    }
  }

  async sendDm(userId: string, text: string, html?: string): Promise<void> {
    const [conv] = await this.deps.db
      .select()
      .from(conversations)
      .where(eq(conversations.matrixUserId, userId));
    const roomId = conv?.dmRoomId ?? (await this.matrix.ensureDm(userId));
    await this.matrix.sendText(roomId, text, html);
  }

  async threadMessage(postId: number, text: string): Promise<void> {
    const post = await getPost(this.deps.db, postId);
    if (post.cardEventId && post.cardRoomId) await this.thread(post, text);
  }

  /** After the auto channels: one message in #medienteam, one DM to the member. */
  async afterPublish(postId: number): Promise<void> {
    const post = await getPost(this.deps.db, postId);
    const channels = await getChannels(this.deps.db, postId);
    const roomId =
      post.cardRoomId ?? (await this.membership.medienteamRoomId());
    if (roomId && post.approvedBy) {
      const approverId = this.matrixIdOf(post.approvedBy);
      const msg = approvedSummary({
        approver: post.approvedBy,
        channels: channels.map((c) => ({
          channel: c.channel,
          mode: c.mode,
          status: c.status,
          url: c.url,
        })),
        copyHelperUrl: copyHelperUrl(
          this.deps,
          postId,
          channels.find((c) => c.mode === 'copy')?.channel,
        ),
      });
      await this.matrix.sendText(roomId, msg.body, msg.html, {
        mentions: [approverId],
      });
    }
    const links = channels
      .filter(
        (c) =>
          c.url && (c.status === 'veroeffentlicht' || c.status === 'erledigt'),
      )
      .sort((a, b) => ORDER.indexOf(a.channel) - ORDER.indexOf(b.channel))
      .map((c) => ({ channel: c.channel, url: c.url! }));
    await this.sendDm(
      post.authorMatrixId,
      dmPublished(post.facts.title ?? 'Beitrag', links),
    );
  }

  /** Upserts a settings row, but only writes when the value changed. */
  private async saveSetting(key: string, value: unknown): Promise<void> {
    const [row] = await this.deps.db
      .select()
      .from(settings)
      .where(eq(settings.key, key));
    if (row && sameJson(row.value, value)) return;
    await this.deps.db
      .insert(settings)
      .values({ key, value, updatedBy: 'postomat' })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  /**
   * Publishes the joined rooms for the web room picker (/admin/raeume) and the
   * bot's own user id (key `matrix_bot_user_id`, for matrix.to links).
   * DMs are left out: rooms with a member conversation and rooms marked as
   * direct; small group rooms (e.g. a Medienteam of two) stay pickable.
   */
  async publishRoomDirectory(): Promise<void> {
    await this.saveSetting('matrix_bot_user_id', this.matrix.userId);
    const dmRooms = new Set(
      (
        await this.deps.db
          .select({ roomId: conversations.dmRoomId })
          .from(conversations)
      ).map((r) => r.roomId),
    );
    const rooms = [];
    for (const roomId of await this.matrix.getJoinedRooms()) {
      if (dmRooms.has(roomId)) continue;
      const info = await this.matrix.getRoomInfo(roomId).catch(() => null);
      if (!info || info.direct) continue;
      if (info.direct === undefined && info.memberCount < 2) continue; // only the bot
      rooms.push(info);
    }
    rooms.sort((a, b) => a.roomId.localeCompare(b.roomId));
    await this.saveSetting('matrix_room_directory', rooms);
  }

  async registerJobs(queue: JobQueue): Promise<void> {
    await queue.work('bot.card', async ({ postId }) => this.syncCard(postId));
    await queue.work('bot.dm', async ({ matrixUserId, text, html }) =>
      this.sendDm(matrixUserId, text, html),
    );
    await queue.work('bot.thread', async ({ postId, text }) =>
      this.threadMessage(postId, text),
    );
    await queue.work('bot.after-publish', async ({ postId }) =>
      this.afterPublish(postId),
    );
  }
}

const ORDER = [
  'wordpress',
  'wiki',
  'meetup',
  'instagram',
  'facebook',
] as const satisfies readonly (keyof typeof CHANNEL_NAMES)[];
