import type { MatrixIncoming } from '@postomat/core';

/** A raw (decrypted) Matrix room event as matrix-bot-sdk delivers it. */
export type RawEvent = {
  type: string;
  sender: string;
  event_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: Record<string, any>;
  state_key?: string;
};

/**
 * Converts raw (decrypted) events into MatrixIncoming.
 * - Reactions (m.annotation) keep their key as sent, incl. skin tones and
 *   the U+FE0F variation selector ("👍️", "👍🏽").
 * - Edits (m.replace) are ignored; the original message was handled already.
 * - Thread messages carry their thread root; a rich-reply fallback quote
 *   ("> <@user> …") is stripped from the body.
 */
export function normalise(
  roomId: string,
  event: RawEvent,
): MatrixIncoming | null {
  const c = event.content ?? {};
  if (event.type === 'm.reaction') {
    const rel = c['m.relates_to'];
    if (rel?.rel_type !== 'm.annotation') return null;
    return {
      kind: 'reaction',
      roomId,
      eventId: event.event_id,
      sender: event.sender,
      relatesTo: rel.event_id,
      key: String(rel.key ?? ''),
    };
  }
  if (event.type !== 'm.room.message') return null;
  const rel = c['m.relates_to'];
  if (rel?.rel_type === 'm.replace') return null; // ignore edits
  let body = String(c['body'] ?? '');
  // Strip reply fallbacks ("> <@user> …"), also in threads.
  if (rel?.['m.in_reply_to'] && /^> /.test(body))
    body = body.replace(/^(>.*\n)+\n?/, '');
  return {
    kind: 'message',
    roomId,
    eventId: event.event_id,
    sender: event.sender,
    msgtype: String(c['msgtype'] ?? ''),
    body: body.trim(),
    threadRoot: rel?.rel_type === 'm.thread' ? rel.event_id : undefined,
    content: c,
  };
}
