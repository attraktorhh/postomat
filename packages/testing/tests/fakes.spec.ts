import { describe, expect, it } from 'vitest';
import { FakeMatrix, renderMeetupIcal } from '../src/index.ts';

describe('FakeMatrix', () => {
  it('tracks messages, threads and in-place edits', async () => {
    const m = new FakeMatrix();
    m.addRoom('!r:x', [m.userId, '@a:x'], { alias: '#r:x' });
    const id = await m.sendText('!r:x', 'v1');
    await m.sendText('!r:x', 'im Thread', undefined, { threadRoot: id });
    await m.sendText('!r:x', 'v2', undefined, { replaces: id });
    expect(m.latest(id)?.body).toBe('v2');
    expect(m.messages('!r:x', id).map((x) => x.body)).toEqual(['im Thread']);
    expect(await m.resolveRoom('#r:x')).toBe('!r:x');
    expect(await m.ensureDm('@b:x')).toBe(await m.ensureDm('@b:x'));
  });
});

describe('renderMeetupIcal', () => {
  it('escapes text and folds long lines with CRLF', () => {
    const ics = renderMeetupIcal([
      {
        id: '1',
        title: 'A; B, C',
        start: '2026-12-11T18:00',
        description: 'x'.repeat(200),
      },
    ]);
    expect(ics).toContain('SUMMARY:A\\; B\\, C');
    expect(ics).toContain('UID:event_1@meetup.com');
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(
      true,
    );
  });
});
