import { describe, expect, it } from 'vitest';
import { build } from './fixtures.ts';
import { DEFAULT_CONFIG } from '@postomat/core';
import {
  buildDrafts,
  dmPublished,
  instagramExcerpt,
  renderCard,
  wikiContent,
  wikiEscape,
  wordpressTitle,
  type TemplateContext,
} from '../src/index.ts';

const ctx = (facts: TemplateContext['facts']): TemplateContext => ({
  type: 'event',
  config: DEFAULT_CONFIG,
  defaultDurationMin: 180,
  facts: { date: '2026-12-11', startTime: '18:00', ...facts },
});

describe('member text in public channels', () => {
  it('strips HTML from the WordPress title', () => {
    const c = ctx({ title: 'Lötkurs<img src=x onerror=alert(1)> <b>neu</b>' });
    const d = build(c, ['wordpress']).wordpress!;
    const t = wordpressTitle(c, d);
    expect(t).not.toMatch(/[<>]/);
    expect(t).toBe('Lötkurs neu');
  });

  it('escapes wikitext in title and description', () => {
    const c = ctx({
      title: 'Löten}} [[Kategorie:Spam]] {{subst:X',
      description:
        "* Liste\n== Titel ==\n'''fett''' __NOTOC__ ~~~~ <script>x</script> [https://spam.example Link]",
    });
    const d = build(c, ['wiki']).wiki!;
    const out = wikiContent(c, d, { meetupId: '123abc', website: null });
    const body = out.slice(out.indexOf('}}\n') + 3);
    // Exactly one template, closed by us.
    expect(out.match(/\{\{/g)).toHaveLength(1);
    expect(out.match(/\}\}/g)).toHaveLength(1);
    for (const bad of ['[[', '[https', "'''", '__NOTOC__', '~~~~', '<script'])
      expect(body).not.toContain(bad);
    expect(body).not.toMatch(/^[*=]/m);
    // Non-numeric meetup ids are dropped.
    expect(out).not.toContain('meetupid');
    expect(wikiEscape('Was geht’s? Löten & mehr!')).toBe(
      'Was geht’s? Löten & mehr!',
    );
  });

  it('puts an end after midnight on the next day', () => {
    const c = ctx({ title: 'Nachtlöten', startTime: '22:00' });
    const d = build(c, ['wiki']).wiki!;
    const out = wikiContent(c, d, { meetupId: '42' });
    expect(out).toContain('|date=2026/12/11 10:00:00 PM');
    expect(out).toContain('|enddate=2026/12/12 01:00:00 AM');
    expect(out).toContain('|meetupid=42');
  });
});

describe('channel wording', () => {
  it('mentions Meetup sign-up on Instagram only when Meetup is used', () => {
    const c = ctx({ title: 'Lötkurs', places: 8 });
    const withMeetup = build(c, ['instagram', 'meetup']).instagram!;
    const without = build(c, ['instagram']).instagram!;
    expect(withMeetup.textDe).toContain(
      '🎟️ 8 Plätze, Anmeldung über Meetup (Link in Bio)',
    );
    expect(without.textDe).toContain('🎟️ 8 Plätze');
    expect(without.textDe).not.toContain('Meetup');
    expect(without.textEn).not.toContain('Meetup');
  });

  it('adds no claims of its own to the Meetup text', () => {
    const d = build(
      ctx({ title: 'Kurs', isWorkshop: true, audience: 'Anfänger' }),
      ['meetup'],
    ).meetup!;
    expect(d.textDe).not.toContain('Vorkenntnisse');
    expect(d.textDe).toContain('👥 Für: Anfänger');
  });

  it('writes the Facebook date as prose', () => {
    const d = build(ctx({ title: 'Lötkurs', endTime: '21:00' }), [
      'facebook',
    ]).facebook!;
    expect(d.textDe).toMatch(
      /^Lötkurs am Fr 11\.12\. von 18 bis 21 Uhr im Attraktor\./,
    );
  });

  it('takes the Instagram excerpt from the body, not the hook', () => {
    const d = build(
      ctx({ title: 'Lötkurs', description: 'Du lötest ein Abzeichen.' }),
      ['instagram'],
    ).instagram!;
    expect(instagramExcerpt(d)).toBe('Du lötest ein Abzeichen.');
  });
});

describe('member and card messages', () => {
  it('says "online" only with at least one link', () => {
    expect(dmPublished('Nixie-Uhr', [])).toBe(
      '👍 Dein Beitrag „Nixie-Uhr“ ist freigegeben. Ich schicke dir die Links, sobald er online ist.',
    );
    expect(
      dmPublished('Lötkurs', [{ channel: 'wordpress', url: 'http://w/1' }]),
    ).toBe('✅ Dein Lötkurs ist online!\n• Website: http://w/1');
  });

  const card = (status: 'zur_freigabe' | 'online' | 'verworfen', version = 1) =>
    renderCard({
      title: 'Lötkurs',
      authorUsername: 'lena',
      version,
      status,
      type: 'event',
      facts: {},
      channels: [],
      checks: [],
      editUrl: 'http://x/r/1',
    });

  it('shows the version once', () => {
    const body = card('zur_freigabe', 2).body;
    expect(body.split('\n')[0]).toBe('Lötkurs · von @lena · v2 · Zur Freigabe');
  });

  it('drops approval hints once the post is done', () => {
    expect(card('zur_freigabe').body).toContain('👍 freigeben');
    for (const s of ['online', 'verworfen'] as const) {
      const c = card(s);
      expect(c.body).not.toContain('👍');
      expect(c.body).toContain('Im Browser ansehen ↗ http://x/r/1');
    }
  });
});
