import { describe, expect, it } from 'vitest';
import { build } from './fixtures.ts';
import { DEFAULT_CONFIG, runChecks } from '@postomat/core';
import {
  buildDrafts,
  facebookText,
  instagramCaption,
  meetupCopyFields,
  renderCard,
  approvedSummary,
  wikiContent,
  wikiPageTitle,
  wordpressContent,
  type TemplateContext,
} from '../src/index.ts';

const event: TemplateContext = {
  type: 'event',
  config: DEFAULT_CONFIG,
  defaultDurationMin: 180,
  facts: {
    title: 'Lötkurs für Anfänger',
    description:
      'An einem Abend lötest du dein eigenes blinkendes Abzeichen. Keine Vorkenntnisse nötig.',
    date: '2026-12-11',
    startTime: '18:00',
    places: 8,
    costs: '5 € Material',
    isWorkshop: true,
  },
};

const projekt: TemplateContext = {
  type: 'projekt',
  config: DEFAULT_CONFIG,
  defaultDurationMin: 180,
  facts: {
    title: 'Nixie-Uhr',
    description: 'Eine Uhr mit alten Röhren aus der DDR.',
    trickiest: 'Die Hochspannung',
  },
};

const links = {
  meetup: 'https://www.meetup.com/attraktor/events/312070001/',
  website: 'http://localhost:8081/loetkurs/',
  wiki: null,
  meetupId: '312070001',
};

describe('channel texts: AI body in the template frame', () => {
  it('event drafts (DE + EN) per channel', () => {
    const drafts = build(event, [
      'wordpress',
      'wiki',
      'meetup',
      'instagram',
      'facebook',
    ]);
    expect(drafts).toMatchSnapshot();
    for (const ch of [
      'wordpress',
      'meetup',
      'instagram',
      'facebook',
    ] as const) {
      expect(drafts[ch]!.textDe.length).toBeGreaterThan(10);
      expect(drafts[ch]!.textEn.length).toBeGreaterThan(10);
    }
  });

  it('event outputs', () => {
    const d = build(event, [
      'wordpress',
      'wiki',
      'meetup',
      'instagram',
      'facebook',
    ]);
    const caption = instagramCaption(d.instagram!);
    expect(caption).toContain('🕓 Freitag, den 11.12.26 | 18 – 21 Uhr');
    expect(caption).toContain('📍 Attraktor e.V., Eschelsweg 4, 22767 Hamburg');
    expect(caption).toContain('🇬🇧');
    expect(caption).toMatchSnapshot('instagram');
    expect(facebookText(d.facebook!, links)).toMatchSnapshot('facebook');
    expect(
      meetupCopyFields(event, d.meetup!, 'Bildung & Workshops'),
    ).toMatchSnapshot('meetup');
    expect(wordpressContent(event, d.wordpress!, links)).toMatchSnapshot(
      'wordpress',
    );
    expect(wikiPageTitle(event)).toBe('Termin:Lötkurs für Anfänger 2026-12-11');
    expect(wikiContent(event, d.wiki!, links)).toMatchSnapshot('wiki');
  });

  it('projekt drafts and outputs', () => {
    const d = build(projekt, ['instagram', 'facebook']);
    expect(Object.keys(d)).toEqual(['instagram', 'facebook']);
    expect(instagramCaption(d.instagram!)).toMatchSnapshot('instagram');
    expect(facebookText(d.facebook!, {})).toMatchSnapshot('facebook');
    expect(instagramCaption(d.instagram!)).toContain(
      'Das Kniffligste: Die Hochspannung.',
    );
  });

  it('uses AI bodies when present', () => {
    const d = build(
      {
        ...event,
        ai: {
          hookDe: 'Du wolltest schon immer mal löten? 🔥',
          bodyDe: 'KI.',
          bodyEn: 'AI.',
          shortEn: 'Short.',
          titleEn: 'Soldering for beginners',
        },
      },
      ['instagram', 'meetup'],
    );
    expect(
      d.instagram!.textDe.startsWith('Du wolltest schon immer mal löten? 🔥'),
    ).toBe(true);
    expect(d.meetup!.fields['title']).toBe(
      'Lötkurs für Anfänger / Soldering for beginners',
    );
  });

  it('keeps Instagram within 8 hashtags', () => {
    const many = {
      ...DEFAULT_CONFIG,
      hashtags: {
        ...DEFAULT_CONFIG.hashtags,
        base: Array.from({ length: 12 }, (_, i) => `#t${i}`),
      },
    };
    const d = build({ ...event, config: many }, ['instagram']);
    expect(d.instagram!.fields['hashtags'].split(' ')).toHaveLength(8);
  });
});

describe('Matrix messages', () => {
  it('renders the card', () => {
    const checks = runChecks({
      post: {
        id: 1,
        type: 'event',
        status: 'zur_freigabe',
        version: 1,
        facts: event.facts,
        authorMatrixId: '@lena:localhost',
        authorUsername: 'lena',
      },
      channels: [],
      photos: [{ id: 1, consent: 'frei', kind: 'photo' }],
      now: new Date('2026-11-23T13:00:00Z'),
    });
    const card = renderCard({
      title: 'Lötkurs für Anfänger',
      authorUsername: 'lena',
      version: 1,
      status: 'zur_freigabe',
      type: 'event',
      facts: event.facts,
      instagramExcerpt: 'Lust auf „Lötkurs für Anfänger“? 🔥',
      channels: [
        { channel: 'wordpress', mode: 'auto', status: 'entwurf' },
        { channel: 'wiki', mode: 'auto', status: 'entwurf' },
        { channel: 'meetup', mode: 'copy', status: 'entwurf' },
        { channel: 'instagram', mode: 'copy', status: 'entwurf' },
        { channel: 'facebook', mode: 'copy', status: 'entwurf' },
      ],
      note: 'Lötstationen sind da, niemand muss etwas mitbringen.',
      checks,
      editUrl: 'http://localhost:3000/redaktion/1',
    });
    expect(card.body).toMatchSnapshot();
    expect(card.html).toContain(
      '<a href="http://localhost:3000/redaktion/1">Im Browser bearbeiten ↗</a>',
    );
  });

  it('only claims channels online that really are', () => {
    const msg = approvedSummary({
      approver: 'mira',
      copyHelperUrl: 'http://x/k',
      channels: [
        { channel: 'wordpress', mode: 'auto', status: 'fehler' },
        { channel: 'wiki', mode: 'auto', status: 'veroeffentlicht' },
        { channel: 'meetup', mode: 'copy', status: 'kopieren' },
      ],
    });
    expect(msg.body).toBe(
      'Freigegeben von @mira. Wiki ist online. ⚠️ Website: Fehler\n@mira: Meetup braucht dich kurz 👉 Kopierhilfe öffnen http://x/k',
    );
  });
});

describe('dmSummary', () => {
  it('shows a Projekt description only once', async () => {
    const { dmSummary } = await import('../src/messages.ts');
    const msg = dmSummary({
      type: 'projekt',
      facts: { title: 'Nixie-Uhr', description: 'Eine Uhr mit Röhren.' },
      channels: [{ channel: 'instagram', mode: 'copy' }],
      url: 'http://postomat.test/b/1',
      excerpt: 'Eine Uhr mit Röhren.',
    });
    expect(msg.body.split('Eine Uhr mit Röhren.').length - 1).toBe(1);
    expect(msg.body).toContain('Nixie-Uhr\nProjekt\n');
  });
});
