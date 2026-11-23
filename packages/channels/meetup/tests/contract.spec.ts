import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractTarget, env, FakeMeetupFeed } from '@postomat/testing';
import { fetchFeed } from '../src/index.ts';

describe(`Meetup iCal contract (${contractTarget()})`, () => {
  let fake: FakeMeetupFeed | undefined;
  let url: string;
  const id = String(390000000 + Math.floor(Math.random() * 99999));

  beforeAll(async () => {
    const event = { id, title: 'Contract Test / Contract test', start: '2026-12-11T18:00', end: '2026-12-11T21:00', description: 'Hallo, Welt; mit Sonderzeichen' };
    if (contractTarget() === 'local') {
      url = env('MEETUP_ICAL_URL', 'http://localhost:8084/attraktor/events/ical/');
      const base = new URL(url).origin;
      const res = await fetch(`${base}/_fake/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
      expect(res.ok).toBe(true);
    } else {
      fake = await new FakeMeetupFeed().start();
      fake.events.push(event);
      url = fake.url;
    }
  });
  afterAll(async () => fake?.stop());

  it('parses UID, URL, title and Berlin start time', async () => {
    const events = await fetchFeed(url);
    const e = events.find((x) => x.meetupId === id);
    expect(e).toBeDefined();
    expect(e!.uid).toBe(`event_${id}@meetup.com`);
    expect(e!.url).toBe(`https://www.meetup.com/attraktor/events/${id}/`);
    expect(e!.summary).toBe('Contract Test / Contract test');
    expect(e!.description).toBe('Hallo, Welt; mit Sonderzeichen');
    expect(e!.start.toISOString()).toBe('2026-12-11T17:00:00.000Z');
  });
});
