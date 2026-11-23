/**
 * Date and time helpers. All "local" values are Europe/Berlin wall-clock values.
 * Local dates are `YYYY-MM-DD` strings, local times `HH:MM` strings.
 */
export const TIMEZONE = 'Europe/Berlin';

const WEEKDAYS_DE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];
const WEEKDAYS_SHORT_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_EN = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const pad2 = (n: number): string => String(n).padStart(2, '0');

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function zonedParts(instant: Date): ZonedParts {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The local Berlin date (`YYYY-MM-DD`) of an instant. */
export function localDateOf(instant: Date): string {
  const p = zonedParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The local Berlin time (`HH:MM`) of an instant. */
export function localTimeOf(instant: Date): string {
  const p = zonedParts(instant);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function offsetMinutes(instant: Date): number {
  const p = zonedParts(instant);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Converts a Berlin wall-clock date + time to an instant (handles DST). */
export function berlinToInstant(date: string, time = '00:00'): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let instant = new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  // Second pass fixes guesses close to a DST switch.
  instant = new Date(guess - offsetMinutes(instant) * 60000);
  return instant;
}

/** Weekday index 0 (Sunday) – 6 of a local date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export function isValidDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d
  );
}

const split = (date: string) =>
  date.split('-').map(Number) as [number, number, number];

/** "Freitag" */
export const weekdayDe = (date: string): string => WEEKDAYS_DE[weekdayOf(date)];
/** "Fr" */
export const weekdayShortDe = (date: string): string =>
  WEEKDAYS_SHORT_DE[weekdayOf(date)];

/** "11.12." */
export function dayMonthDe(date: string): string {
  const [, m, d] = split(date);
  return `${pad2(d)}.${pad2(m)}.`;
}

/** "11.12.26" */
export function shortDateDe(date: string): string {
  const [y, m, d] = split(date);
  return `${pad2(d)}.${pad2(m)}.${String(y).slice(2)}`;
}

/** "11.12.2026" */
export function fullDateDe(date: string): string {
  const [y, m, d] = split(date);
  return `${pad2(d)}.${pad2(m)}.${y}`;
}

/** "Freitag, 11.12." */
export const weekdayDateDe = (date: string): string =>
  `${weekdayDe(date)}, ${dayMonthDe(date)}`;

/** "Fr 11.12." */
export const shortWeekdayDateDe = (date: string): string =>
  `${weekdayShortDe(date)} ${dayMonthDe(date)}`;

/** "18 Uhr" or "18:30 Uhr" style hour for ranges: "18" / "18:30". */
function hourDe(time: string): string {
  const [h, m] = time.split(':');
  return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
}

/** "18 – 21 Uhr" or "18 Uhr" */
export function timeRangeDe(start: string, end?: string): string {
  return end ? `${hourDe(start)} – ${hourDe(end)} Uhr` : `${hourDe(start)} Uhr`;
}

/** Banner / Instagram line: "Freitag, den 11.12.26 | 18 – 21 Uhr" */
export function bannerWhenDe(
  date: string,
  start?: string,
  end?: string,
): string {
  const day = `${weekdayDe(date)}, den ${shortDateDe(date)}`;
  return start ? `${day} | ${timeRangeDe(start, end)}` : day;
}

function hourEn(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}` + suffix : `${h12}:${pad2(m)}${suffix}`;
}

/** "6–9 pm" style English time range. */
export function timeRangeEn(start: string, end?: string): string {
  if (!end) return hourEn(start);
  const a = hourEn(start);
  const b = hourEn(end);
  if (a.slice(-2) === b.slice(-2))
    return `${a.slice(0, -2)}–${b.slice(0, -2)} ${b.slice(-2)}`;
  return `${a}–${b}`;
}

/** "Friday, 11 Dec" */
export function dateEn(date: string): string {
  const [, m, d] = split(date);
  return `${WEEKDAYS_EN[weekdayOf(date)]}, ${d} ${MONTHS_EN[m - 1]}`;
}

/** MediaWiki {{Termin}} date: "2026/11/25 07:30:00 PM" */
export function wikiDateTime(date: string, time: string): string {
  const [y, m, d] = split(date);
  const [h, min] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${y}/${pad2(m)}/${pad2(d)} ${pad2(h12)}:${pad2(min)}:00 ${ampm}`;
}

/** "seit 1 Std." style relative age for queues. */
export function ageDe(from: Date, now: Date): string {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - from.getTime()) / 60000),
  );
  if (minutes < 60) return `seit ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `seit ${hours} Std.`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'seit 1 Tag' : `seit ${days} Tagen`;
}
