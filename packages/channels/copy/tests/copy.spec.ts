import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@postomat/core';
import { buildDrafts } from '@postomat/templates';
import { COPY_IMAGE_FORMAT, copyFieldsFor } from '../src/index.ts';

const ctx = {
  type: 'event' as const,
  config: DEFAULT_CONFIG,
  defaultDurationMin: 180,
  facts: {
    title: 'Lötkurs',
    date: '2026-12-11',
    startTime: '18:00',
    description: 'Löten.',
    places: 8,
  },
};

describe('copyFieldsFor', () => {
  // AI-written bodies (stub); the templates add the fixed frame.
  const ai = {
    hookDe: 'Lust auf Löten? 🔥',
    bodyDe: 'Löten.',
    titleEn: 'Soldering',
    bodyEn: 'Soldering.',
    shortEn: 'Soldering at Attraktor.',
  };
  const drafts = buildDrafts({ ...ctx, ai }, [
    'instagram',
    'facebook',
    'meetup',
  ]);

  it('gives Instagram text and hashtags as separate fields', () => {
    expect(
      copyFieldsFor('instagram', ctx, drafts.instagram!, {}).map((f) => f.key),
    ).toEqual(['text', 'hashtags']);
  });

  it('adds the Meetup link to Facebook once known', () => {
    const [text] = copyFieldsFor('facebook', ctx, drafts.facebook!, {
      meetup: 'https://www.meetup.com/attraktor/events/1/',
    });
    expect(text.value).toContain(
      'Anmeldung: https://www.meetup.com/attraktor/events/1/',
    );
  });

  it('gives every Meetup field incl. the category', () => {
    const fields = copyFieldsFor('meetup', ctx, drafts.meetup!, {}, 'Technik');
    expect(fields.map((f) => f.label)).toEqual([
      'Titel',
      'Datum',
      'Uhrzeit',
      'Ort',
      'Teilnehmer max.',
      'Beschreibung',
      'Kategorie',
    ]);
    expect(fields.find((f) => f.key === 'time')?.value).toBe('18:00 – 21:00');
  });

  it('uses 4:5 for Instagram/Facebook and 16:9 for Meetup', () => {
    expect([
      COPY_IMAGE_FORMAT.instagram,
      COPY_IMAGE_FORMAT.facebook,
      COPY_IMAGE_FORMAT.meetup,
    ]).toEqual(['4x5', '4x5', '16x9']);
  });
});
