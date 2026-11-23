// Fake Meetup iCal server for local development. Dependency-free (Node 24).
//
//   GET    /attraktor/events/ical/  -> text/calendar feed (mimics meetup.com)
//   GET    /_fake/events            -> JSON list of stored events
//   POST   /_fake/events            -> add/replace an event (JSON body, see README)
//   DELETE /_fake/events            -> clear all events
//   GET    /healthz                 -> "ok"
//
// State is kept in a JSON file (STATE_FILE, default /data/events.json).
// Times in the JSON are local Europe/Berlin wall-clock times ("2026-12-11T18:00").

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const PORT = Number(process.env.PORT ?? 8084);
const STATE_FILE = process.env.STATE_FILE ?? '/data/events.json';
// Used as the initial state while STATE_FILE does not exist yet.
const INITIAL_FILE = process.env.INITIAL_FILE ?? new URL('./events.json', import.meta.url).pathname;
const GROUP = process.env.MEETUP_GROUP ?? 'attraktor';
const CAL_NAME = process.env.CAL_NAME ?? 'Attraktor e.V. Events';

async function readList(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function loadEvents() {
  return (await readList(STATE_FILE)) ?? (await readList(INITIAL_FILE)) ?? [];
}

async function saveEvents(events) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(events, null, 2) + '\n');
  await rename(tmp, STATE_FILE);
}

// --- iCalendar helpers -----------------------------------------------------

function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Fold a content line to max 75 octets (RFC 5545 3.1), never splitting a
// UTF-8 multi-byte sequence. Continuation lines start with a single space.
function foldLine(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // back off while `end` points into the middle of a UTF-8 sequence
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // leading space counts towards the 75 octets
  }
  return parts.join('\r\n ');
}

// "2026-12-11T18:00" or "2026-12-11T18:00:00" -> "20261211T180000"
function localStamp(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? ''));
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? '00'}`;
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'X-LIC-LOCATION:Europe/Berlin',
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

function buildCalendar(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meetup//Meetup Events v1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-ORIGINAL-URL:https://www.meetup.com/${GROUP}/events/ical/`,
    `X-WR-CALNAME:${escapeText(CAL_NAME)}`,
    'X-MS-OLK-FORCEINSPECTOROPEN:TRUE',
    ...VTIMEZONE,
  ];
  const sorted = [...events].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  for (const ev of sorted) {
    const url = `https://www.meetup.com/${GROUP}/events/${ev.id}/`;
    lines.push(
      'BEGIN:VEVENT',
      `DTSTAMP:${utcStamp(new Date(ev.updatedAt ?? Date.now()))}`,
      `DTSTART;TZID=Europe/Berlin:${localStamp(ev.start)}`,
      `DTEND;TZID=Europe/Berlin:${localStamp(ev.end)}`,
      'STATUS:CONFIRMED',
      `SUMMARY:${escapeText(ev.title)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'CLASS:PUBLIC',
      `CREATED:${utcStamp(new Date(ev.createdAt ?? Date.now()))}`,
      `GEO:53.55;10.03`,
      `LOCATION:${escapeText(ev.location ?? 'Attraktor e.V. (Mexikoring 21, Hamburg)')}`,
      `URL;VALUE=URI:${url}`,
      `LAST-MODIFIED:${utcStamp(new Date(ev.updatedAt ?? Date.now()))}`,
      `UID:event_${ev.id}@meetup.com`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// --- HTTP ------------------------------------------------------------------

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n';
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function validate(ev) {
  const errors = [];
  if (!/^\d+$/.test(String(ev.id ?? ''))) errors.push('id must be a numeric string');
  if (!ev.title) errors.push('title is required');
  if (!localStamp(ev.start)) errors.push('start must look like 2026-12-11T18:00');
  if (!localStamp(ev.end)) errors.push('end must look like 2026-12-11T21:00');
  return errors;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && pathname === '/healthz') return send(res, 200, 'ok\n', 'text/plain');

    if (req.method === 'GET' && (pathname === `/${GROUP}/events/ical/` || pathname === `/${GROUP}/events/ical`)) {
      return send(res, 200, buildCalendar(await loadEvents()), 'text/calendar; charset=utf-8');
    }

    if (pathname === '/_fake/events') {
      if (req.method === 'GET') return send(res, 200, await loadEvents());
      if (req.method === 'DELETE') {
        await saveEvents([]);
        return send(res, 200, { ok: true, count: 0 });
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        const ev = {
          id: String(body.id ?? ''),
          title: body.title,
          start: body.start,
          end: body.end,
          description: body.description ?? '',
          ...(body.location ? { location: body.location } : {}),
        };
        const errors = validate(ev);
        if (errors.length) return send(res, 400, { ok: false, errors });
        const events = await loadEvents();
        const now = new Date().toISOString();
        const idx = events.findIndex((e) => e.id === ev.id);
        if (idx >= 0) events[idx] = { ...events[idx], ...ev, updatedAt: now };
        else events.push({ ...ev, createdAt: now, updatedAt: now });
        await saveEvents(events);
        return send(res, idx >= 0 ? 200 : 201, { ok: true, event: ev, replaced: idx >= 0 });
      }
      return send(res, 405, { ok: false, error: 'method not allowed' });
    }

    send(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error(err);
    send(res, err instanceof SyntaxError ? 400 : 500, { ok: false, error: String(err.message ?? err) });
  }
});

server.listen(PORT, () => console.log(`fake-meetup listening on :${PORT}, state file ${STATE_FILE}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
