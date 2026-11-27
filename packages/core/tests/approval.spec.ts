import { describe, expect, it } from 'vitest';
import { decideApproval, type ApprovalInput } from '../src/approval.ts';
import type { ChannelPostSnapshot, PostSnapshot } from '../src/types.ts';
import { runChecks } from '../src/checks.ts';

const NOW = new Date('2026-11-23T14:44:00Z');

const post = (over: Partial<PostSnapshot> = {}): PostSnapshot => ({
  id: 42,
  type: 'event',
  status: 'zur_freigabe',
  version: 1,
  authorMatrixId: '@lena:localhost',
  authorUsername: 'lena',
  facts: {
    title: 'Lötkurs für Anfänger',
    date: '2026-12-11',
    startTime: '18:00',
    description: 'Wir löten.',
  },
  ...over,
});

const channel = (
  c: Partial<ChannelPostSnapshot> & Pick<ChannelPostSnapshot, 'channel'>,
): ChannelPostSnapshot => ({
  mode: 'copy',
  status: 'entwurf',
  textDe: 'Text',
  textEn: 'Text',
  fields: {},
  ...c,
});

const input = (over: Partial<ApprovalInput> = {}): ApprovalInput => ({
  post: post(),
  channels: [
    channel({ channel: 'wordpress', mode: 'auto' }),
    channel({ channel: 'meetup' }),
  ],
  photos: [{ id: 1, consent: 'frei', kind: 'photo' }],
  now: NOW,
  approverUsername: 'mira',
  approverIsMedienteam: true,
  version: 1,
  meetupCategory: 'Technik',
  ...over,
});

describe('decideApproval', () => {
  it('approves a valid post by another Medienteam member', () => {
    expect(decideApproval(input()).kind).toBe('approve');
  });

  it('refuses self-approval even for Medienteam members', () => {
    expect(decideApproval(input({ approverUsername: 'lena' })).kind).toBe(
      'self_approval',
    );
  });

  it('ignores users outside the Medienteam', () => {
    expect(
      decideApproval(
        input({ approverIsMedienteam: false, approverUsername: 'gast' }),
      ).kind,
    ).toBe('not_medienteam');
  });

  it('rejects a 👍 on an outdated card version', () => {
    expect(
      decideApproval(input({ post: post({ version: 2 }), version: 1 })).kind,
    ).toBe('outdated_version');
  });

  it('rejects a 👍 while a change is requested', () => {
    expect(
      decideApproval(input({ post: post({ status: 'aenderung_gewuenscht' }) }))
        .kind,
    ).toBe('outdated_version');
  });

  it('ignores 👍 on posts that are already approved', () => {
    expect(
      decideApproval(input({ post: post({ status: 'geplant' }) })).kind,
    ).toBe('wrong_state');
  });

  it('blocks events in the past', () => {
    const d = decideApproval(
      input({ post: post({ facts: { ...post().facts, date: '2026-11-01' } }) }),
    );
    expect(d.kind).toBe('blocked');
    if (d.kind === 'blocked')
      expect(d.failures.map((f) => f.id)).toContain('date_future');
  });

  it('blocks while the texts do not match the facts', () => {
    const d = decideApproval(input({ post: post({ textsCurrent: false }) }));
    expect(d.kind).toBe('blocked');
    if (d.kind === 'blocked')
      expect(d.failures.map((f) => f.id)).toEqual(['texts_current']);
    expect(
      decideApproval(input({ post: post({ textsCurrent: true }) })).kind,
    ).toBe('approve');
  });

  it('points to "Erneut versuchen" when the rewrite failed', () => {
    const d = decideApproval(
      input({ post: post({ textsCurrent: false, textsFailed: true }) }),
    );
    expect(d.kind === 'blocked' && d.failures[0].label).toBe(
      'Texte passen noch nicht zu den Angaben – oben „Erneut versuchen“',
    );
  });

  it('blocks hand-edited texts the facts changed under', () => {
    const d = decideApproval(
      input({
        channels: [
          channel({ channel: 'wordpress', mode: 'auto', factsStale: true }),
          channel({ channel: 'meetup' }),
        ],
      }),
    );
    expect(d.kind === 'blocked' && d.failures.map((f) => f.id)).toEqual([
      'hand_edited_stale',
    ]);
  });

  it('blocks photos without consent or internal only', () => {
    for (const consent of ['einwilligung_fehlt', 'nur_intern'] as const) {
      const d = decideApproval(
        input({ photos: [{ id: 1, consent, kind: 'photo' }] }),
      );
      expect(d.kind).toBe('blocked');
      if (d.kind === 'blocked')
        expect(d.failures.map((f) => f.id)).toEqual(['photo_consent']);
    }
  });

  it('blocks missing required fields and a missing Projekt photo', () => {
    const d = decideApproval(
      input({
        post: post({
          type: 'projekt',
          facts: { title: 'Nixie-Uhr', description: 'Gebaut.' },
        }),
        photos: [],
      }),
    );
    expect(d.kind).toBe('blocked');
    if (d.kind === 'blocked')
      expect(d.failures[0].label).toBe('Es fehlt: Das Kniffligste, Foto');
  });
});

describe('runChecks warnings', () => {
  it('warns about missing EN text, Meetup category, long title and Instagram limits', () => {
    const checks = runChecks({
      post: post({ facts: { ...post().facts, title: 'x'.repeat(81) } }),
      channels: [
        channel({ channel: 'meetup', textEn: '' }),
        channel({
          channel: 'instagram',
          fields: { hashtags: '#a #b #c #d #e #f #g #h #i' },
        }),
      ],
      photos: [],
      now: NOW,
      meetupCategory: null,
    });
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual([
      'en_text',
      'meetup_category',
      'title_length',
      'instagram_caption',
    ]);
    expect(checks.filter((c) => !c.ok).every((c) => c.level === 'warn')).toBe(
      true,
    );
    expect(checks.find((c) => c.id === 'en_text')?.label).toBe(
      'EN-Text fehlt: Meetup',
    );
  });
});
