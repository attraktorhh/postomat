import {
  advanceDialog,
  initialDialogState,
  type DialogState,
  type MatrixIncoming,
  type MatrixPort,
} from '@postomat/core';
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
  instagramCaption,
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

const COMMANDS = [
  'hilfe',
  'help',
  'status',
  'neu',
  'abbrechen',
  'abschicken',
] as const;
type Command = (typeof COMMANDS)[number];

const asCommand = (text: string): Command | undefined => {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[!.?„“"]/g, '');
  return (COMMANDS as readonly string[]).includes(t)
    ? (t as Command)
    : undefined;
};

const isThumbsUp = (key: string) => key.startsWith('👍');
const isPencil = (key: string) => key.startsWith('✏') || key.startsWith('📝');

export type BotDeps = WorkflowDeps & { matrix: MatrixPort };

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

  async handle(evt: MatrixIncoming): Promise<void> {
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
      const members = await this.matrix.getJoinedMembers(evt.roomId);
      if (members.length > 2) return; // only direct messages
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
    if (evt.msgtype !== 'm.text' && evt.msgtype !== 'm.notice') return;

    const text = evt.body.trim();
    const cmd = asCommand(text);
    if (cmd) return this.onCommand(cmd, evt, conv);

    if (conv.questionPostId) {
      await answerQuestion(
        this.deps,
        conv.questionPostId,
        text,
        localpart(sender),
      );
      await this.say(roomId, DM.rueckfrageAck);
      return;
    }
    await this.runDialog(evt, conv, { kind: 'text', text });
  }

  private async onCommand(
    cmd: Command,
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    conv: Conversation,
  ): Promise<void> {
    const { sender, roomId } = evt;
    const draft = await this.draftOf(sender);
    switch (cmd) {
      case 'hilfe':
      case 'help':
        await this.say(roomId, DM.help);
        return;
      case 'status': {
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
        return;
      }
      case 'abbrechen':
        if (!draft) {
          await this.say(roomId, DM.nothingToCancel);
          return;
        }
        await discardPost(this.deps, draft.id, localpart(sender));
        await this.saveConversation(sender, { state: null, postId: null });
        await this.say(roomId, DM.cancelled);
        return;
      case 'neu':
        if (draft) {
          await this.say(
            roomId,
            `Du hast schon einen Entwurf „${draft.facts.title ?? 'ohne Titel'}“. Schreib „abbrechen“, um ihn zu verwerfen, oder erzähl einfach weiter.`,
          );
          return;
        }
        await this.saveConversation(sender, {
          state: initialDialogState(),
          postId: null,
        });
        await this.say(
          roomId,
          dmGreeting(
            (await this.matrix.getDisplayName(sender)) ?? localpart(sender),
          ),
        );
        return;
      case 'abschicken': {
        if (!draft) {
          await this.say(roomId, DM.nothingToSubmit);
          return;
        }
        const state = conv.state ?? initialDialogState();
        if (state.step !== 'review') {
          await this.say(
            roomId,
            `${DM.notReady} Antworte bitte noch auf meine letzte Frage.`,
          );
          return;
        }
        await submitPost(this.deps, draft.id, localpart(sender));
        await this.saveConversation(sender, { state: null, postId: null });
        await this.say(roomId, DM.submitted);
        return;
      }
    }
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
    await this.runDialog(evt, conv, { kind: 'photo', photoId });
  }

  private async runDialog(
    evt: Extract<MatrixIncoming, { kind: 'message' }>,
    conv: Conversation,
    input: { kind: 'text'; text: string } | { kind: 'photo'; photoId: number },
  ): Promise<void> {
    const { sender, roomId } = evt;
    const deps = this.deps;
    let draft = await this.draftOf(sender);
    let state: DialogState =
      draft && conv.state && conv.postId === draft.id
        ? conv.state
        : initialDialogState();
    if (draft && state.step === 'idle' && conv.postId !== draft.id) {
      // Draft without conversation state (e.g. after a restart): continue collecting.
      state = {
        ...state,
        step: 'collect',
        type: draft.type,
        facts: draft.facts,
      };
    }
    const displayName =
      (await this.matrix.getDisplayName(sender)) ?? localpart(sender);
    const result = await advanceDialog(state, input, {
      now: deps.now(),
      displayName,
      aiExtract: deps.ai
        ? async ({ text, state: s }) =>
            deps.ai!.extract({
              text,
              type: s.type,
              facts: s.facts,
              now: deps.now(),
            })
        : undefined,
    });
    state = result.state;

    if (!draft && state.step !== 'idle') {
      draft = await createDraft(
        deps,
        { matrixId: sender, username: localpart(sender), displayName },
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

    for (const r of result.replies) await this.say(roomId, r);
    for (const effect of result.effects) {
      if (!draft) break;
      if (effect.kind === 'set_consent')
        await setConsent(deps, effect.photoIds, effect.consent);
      if (effect.kind === 'summary') await this.sendSummary(roomId, draft.id);
      if (effect.kind === 'change_request') {
        if (deps.ai) {
          await generateTexts(deps, draft.id, effect.instruction);
          await addHistory(
            deps.db,
            draft.id,
            localpart(sender),
            'edited',
            `Text ändern: „${effect.instruction}“`,
          );
          await this.sendSummary(roomId, draft.id, DM.textsUpdated);
        } else {
          const post = await getPost(deps.db, draft.id);
          const note = [post.note, effect.instruction]
            .filter(Boolean)
            .join('\n');
          await updatePost(deps.db, draft.id, { note });
          await addHistory(
            deps.db,
            draft.id,
            localpart(sender),
            'note',
            `Hinweis: „${effect.instruction}“`,
          );
          await this.say(roomId, DM.noteStored);
        }
      }
    }
  }

  /** "Super, so schicke ich es ans Medienteam:" + banner + hint. */
  private async sendSummary(
    roomId: string,
    postId: number,
    hint: string = DM_SUBMIT_HINT,
  ): Promise<void> {
    await generateTexts(this.deps, postId);
    const post = await getPost(this.deps.db, postId);
    const channels = await getChannels(this.deps.db, postId);
    const banners = await renderBanners(this.deps, post);
    const ig = channels.find(
      (c) => c.channel === 'instagram' && c.mode !== 'off',
    );
    const excerpt = ig
      ? instagramCaption(draftOf(ig))
          .split('\n\n')[1]
          ?.replace(/^✨\s*/, '')
          .slice(0, 160)
      : undefined;
    const msg = dmSummary({
      type: post.type,
      facts: post.facts,
      channels: channels.map((c) => ({ channel: c.channel, mode: c.mode })),
      url: postUrl(this.deps, postId),
      excerpt,
    });
    await this.matrix.sendText(roomId, msg.body, msg.html);
    const banner = banners['4x5'];
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
      if (await this.membership.isMedienteam(evt.sender))
        await requestChange(this.deps, post.id, actor);
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
    if (await answerMeetupQuestion(this.deps, post.id, evt.body, actor)) return;
    if (!(await this.membership.isMedienteam(evt.sender))) return;
    if (
      post.status === 'zur_freigabe' ||
      post.status === 'aenderung_gewuenscht'
    ) {
      await requestChange(this.deps, post.id, actor, evt.body.trim());
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
      this.deps.log.warn('no Medienteam room configured – card not sent', {
        postId,
      });
      return;
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

  /** Publishes the joined rooms for the web room picker (/admin/raeume). */
  async publishRoomDirectory(): Promise<void> {
    const rooms = [];
    for (const roomId of await this.matrix.getJoinedRooms()) {
      const info = await this.matrix.getRoomInfo(roomId).catch(() => null);
      if (info && info.memberCount > 2) rooms.push(info); // skip DMs
    }
    await this.deps.db
      .insert(settings)
      .values({
        key: 'matrix_room_directory',
        value: rooms,
        updatedBy: 'postomat',
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: rooms, updatedAt: new Date() },
      });
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
