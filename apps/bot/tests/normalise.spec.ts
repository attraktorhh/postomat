import { describe, expect, it } from 'vitest';
import { normalise, type RawEvent } from '../src/normalise.ts';

const room = '!medienteam:localhost';

const ev = (type: string, content: Record<string, unknown>): RawEvent => ({
  type,
  sender: '@kai:localhost',
  event_id: '$evt',
  content,
});

describe('normalise (Element event shapes)', () => {
  it.each([
    ['👍', '👍'],
    ['👍️', '👍️'], // with U+FE0F variation selector
    ['👍🏽', '👍🏽'], // skin tone
  ])('keeps the reaction key %s', (key, expected) => {
    const out = normalise(
      room,
      ev('m.reaction', {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: '$card',
          key,
        },
      }),
    );
    expect(out).toEqual({
      kind: 'reaction',
      roomId: room,
      eventId: '$evt',
      sender: '@kai:localhost',
      relatesTo: '$card',
      key: expected,
    });
    expect(out?.kind === 'reaction' && out.key.startsWith('👍')).toBe(true);
  });

  it('ignores reactions that are not annotations', () => {
    expect(
      normalise(room, ev('m.reaction', { 'm.relates_to': { rel_type: 'x' } })),
    ).toBeNull();
  });

  it('reads a thread reply as Element sends it (is_falling_back)', () => {
    const out = normalise(
      room,
      ev('m.room.message', {
        msgtype: 'm.text',
        body: 'Bitte das Datum prüfen',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$card',
          is_falling_back: true,
          'm.in_reply_to': { event_id: '$card' },
        },
      }),
    );
    expect(out).toMatchObject({
      kind: 'message',
      threadRoot: '$card',
      body: 'Bitte das Datum prüfen',
      msgtype: 'm.text',
    });
  });

  it('strips the reply fallback quote of a rich reply', () => {
    const out = normalise(
      room,
      ev('m.room.message', {
        msgtype: 'm.text',
        body: '> <@postomat:localhost> Ist eins davon das Meetup-Event?\n> 1️⃣ …\n\n2',
        'm.relates_to': { 'm.in_reply_to': { event_id: '$q' } },
      }),
    );
    expect(out).toMatchObject({ kind: 'message', body: '2' });
    expect(out?.kind === 'message' && out.threadRoot).toBeFalsy();
  });

  it('strips a fallback quote inside a thread reply too', () => {
    const out = normalise(
      room,
      ev('m.room.message', {
        msgtype: 'm.text',
        body: '> <@postomat:localhost> Frage\n\n1',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: '$card',
          is_falling_back: false,
          'm.in_reply_to': { event_id: '$q' },
        },
      }),
    );
    expect(out).toMatchObject({ body: '1', threadRoot: '$card' });
  });

  it('ignores edits (m.replace)', () => {
    expect(
      normalise(
        room,
        ev('m.room.message', {
          msgtype: 'm.text',
          body: '* korrigiert',
          'm.new_content': { msgtype: 'm.text', body: 'korrigiert' },
          'm.relates_to': { rel_type: 'm.replace', event_id: '$old' },
        }),
      ),
    ).toBeNull();
  });

  it('reads a plain message without thread', () => {
    const out = normalise(
      '!dm:localhost',
      ev('m.room.message', { msgtype: 'm.text', body: '  abschicken  ' }),
    );
    expect(out).toEqual({
      kind: 'message',
      roomId: '!dm:localhost',
      eventId: '$evt',
      sender: '@kai:localhost',
      msgtype: 'm.text',
      body: 'abschicken',
      threadRoot: undefined,
      content: { msgtype: 'm.text', body: '  abschicken  ' },
    });
  });

  it('ignores other event types', () => {
    expect(normalise(room, ev('m.room.member', {}))).toBeNull();
  });
});
