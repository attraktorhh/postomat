import { describe, expect, it } from 'vitest';
import {
  copyActionSchema,
  formFields,
  parseForm,
  postActionSchema,
  roomSettingsSchema,
  submitSchema,
} from '../app/server/forms';

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};
const post = (entries: [string, string][]) =>
  parseForm(postActionSchema, formFields(form(entries)));

describe('postActionSchema', () => {
  it('reads a banner colour from the core list', () => {
    expect(
      post([
        ['intent', 'banner_color'],
        ['color', 'mint'],
      ]),
    ).toEqual({
      success: true,
      data: { intent: 'banner_color', color: 'mint' },
    });
  });

  it('refuses an unknown banner colour with a German message', () => {
    const r = post([
      ['intent', 'banner_color'],
      ['color', 'lila'],
    ]);
    expect(r.error).toBe(
      'Banner-Farbe: ungültiger Wert. Bitte lade die Seite neu.',
    );
  });

  it('asks to reload on an unknown or missing intent', () => {
    const stale =
      'Diese Aktion ist nicht (mehr) möglich. Bitte lade die Seite neu.';
    expect(post([['intent', 'hack']]).error).toBe(stale);
    expect(post([]).error).toBe(stale);
  });

  it('checks consent values and photo ids', () => {
    expect(
      post([
        ['intent', 'consent'],
        ['photoId', '7'],
        ['consent', 'frei'],
      ]).data,
    ).toEqual({ intent: 'consent', photoId: 7, consent: 'frei' });
    expect(
      post([
        ['intent', 'consent'],
        ['photoId', 'x'],
        ['consent', 'frei'],
      ]).error,
    ).toMatch(/^Foto: /);
    expect(
      post([
        ['intent', 'consent'],
        ['photoId', '7'],
        ['consent', 'ja'],
      ]).error,
    ).toMatch(/^Einwilligung: /);
  });

  it('only retries auto channels', () => {
    expect(
      post([
        ['intent', 'retry'],
        ['channel', 'wiki'],
      ]).data,
    ).toEqual({
      intent: 'retry',
      channel: 'wiki',
    });
    expect(
      post([
        ['intent', 'retry'],
        ['channel', 'meetup'],
      ]).error,
    ).toMatch(/^Kanal: /);
  });

  it('keeps unsent text fields absent and trims the others', () => {
    const r = post([
      ['intent', 'save_text'],
      ['channel', 'instagram'],
      ['textDe', ' Hallo '],
      ['hashtags', ' #a '],
    ]);
    expect(r.data).toEqual({
      intent: 'save_text',
      channel: 'instagram',
      textDe: ' Hallo ',
      hashtags: '#a',
    });
  });

  it('falls back to version -1 for an unusable approval version', () => {
    expect(
      post([
        ['intent', 'approve'],
        ['version', 'abc'],
      ]).data,
    ).toEqual({
      intent: 'approve',
      version: -1,
      reviewStamp: '',
    });
    expect(
      post([
        ['intent', 'approve'],
        ['version', '3'],
        ['reviewStamp', 'abc123'],
      ]).data,
    ).toEqual({
      intent: 'approve',
      version: 3,
      reviewStamp: 'abc123',
    });
  });

  it('reads facts, checkboxes and optional comments', () => {
    expect(
      post([
        ['intent', 'facts'],
        ['endTime', ' '],
      ]).data,
    ).toEqual({
      intent: 'facts',
      endTime: undefined,
      isWorkshop: false,
    });
    expect(
      post([
        ['intent', 'facts'],
        ['endTime', '21:00'],
        ['isWorkshop', 'on'],
      ]).data,
    ).toEqual({ intent: 'facts', endTime: '21:00', isWorkshop: true });
    expect(post([['intent', 'request_change']]).data).toEqual({
      intent: 'request_change',
      comment: undefined,
    });
  });

  it('asks for a question text', () => {
    expect(
      post([
        ['intent', 'ask'],
        ['question', '  '],
      ]).error,
    ).toBe('Bitte eine Frage eingeben.');
  });
});

describe('copyActionSchema', () => {
  it('accepts link and skip only', () => {
    const parse = (e: [string, string][]) =>
      parseForm(copyActionSchema, formFields(form(e)));
    expect(
      parse([
        ['intent', 'link'],
        ['url', ' https://x.de '],
      ]).data,
    ).toEqual({ intent: 'link', url: 'https://x.de' });
    expect(parse([['intent', 'skip']]).data).toEqual({ intent: 'skip' });
    expect(parse([['intent', 'other']]).error).toBe(
      'Diese Aktion ist nicht (mehr) möglich. Bitte lade die Seite neu.',
    );
  });
});

describe('submitSchema', () => {
  it('caps the note at 2000 characters', () => {
    expect(parseForm(submitSchema, {}).data).toEqual({ note: '' });
    expect(
      parseForm(submitSchema, { note: 'a'.repeat(3000) }).data?.note,
    ).toHaveLength(2000);
  });
});

describe('roomSettingsSchema', () => {
  it('needs at least one member room', () => {
    expect(parseForm(roomSettingsSchema, { member: [] }).error).toBe(
      'Bitte mindestens einen Mitglieder-Raum wählen.',
    );
    expect(
      parseForm(roomSettingsSchema, { member: ['!a:x'], medienteam: '' }).data,
    ).toEqual({ member: ['!a:x'], medienteam: null });
  });
});
