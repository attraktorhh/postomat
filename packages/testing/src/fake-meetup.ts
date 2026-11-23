import { startServer, type FakeServer } from './server.ts';

export interface FakeMeetupEvent {
  id: string;
  title: string;
  /** Local Europe/Berlin start, e.g. 2026-12-11T18:00 */
  start: string;
  end?: string;
  description?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const local = (s: string) => s.replace(/[-:]/g, '').slice(0, 13) + '00';

function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

/** Renders events in the format of meetup.com/<group>/events/ical/. */
export function renderMeetupIcal(events: FakeMeetupEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meetup//RemoteApi//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Attraktor Events - Meetup',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:+0100',
    'TZOFFSETTO:+0200',
    'TZNAME:CEST',
    'DTSTART:19700329T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0200',
    'TZOFFSETTO:+0100',
    'TZNAME:CET',
    'DTSTART:19701025T030000',
    'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      'DTSTAMP:20261123T120000Z',
      `DTSTART;TZID=Europe/Berlin:${local(e.start)}`,
      ...(e.end ? [`DTEND;TZID=Europe/Berlin:${local(e.end)}`] : []),
      'STATUS:CONFIRMED',
      `SUMMARY:${esc(e.title)}`,
      `DESCRIPTION:${esc(e.description ?? '')}`,
      'CLASS:PUBLIC',
      `CREATED:20261123T120000Z`,
      `GEO:53.56;9.93`,
      `URL;VALUE=URI:https://www.meetup.com/attraktor/events/${e.id}/`,
      `UID:event_${e.id}@meetup.com`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** Serves a mutable Meetup-style iCal feed. */
export class FakeMeetupFeed {
  events: FakeMeetupEvent[] = [];
  requests = 0;
  private server?: FakeServer;

  get url(): string {
    return `${this.server!.url}/attraktor/events/ical/`;
  }

  async start(): Promise<this> {
    this.server = await startServer((req, _body, res) => {
      this.requests++;
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8' });
      res.end(renderMeetupIcal(this.events));
    });
    return this;
  }

  async stop(): Promise<void> {
    await this.server?.close();
  }
}
