import {
  addDays,
  bannerWhenDe,
  dateEn,
  fullDateDe,
  shortWeekdayDateDe,
  timeRangeEn,
  type ChannelId,
  wikiDateTime,
} from '@postomat/core';
import {
  effectiveEnd,
  hashtags,
  title,
  type AiTexts,
  type Links,
  type TemplateContext,
} from './context.ts';

/** Editable texts per channel (what the Redaktion edits). */
export interface ChannelDraft {
  textDe: string;
  textEn: string;
  fields: Record<string, string>;
}

/** Drafts are only built with AI-written bodies; the templates add the fixed frame. */
export type DraftContext = TemplateContext & { ai: AiTexts };

const hookDe = (ctx: DraftContext): string => ctx.ai.hookDe;
const bodyDe = (ctx: DraftContext): string => ctx.ai.bodyDe;

const placesCostsDe = (ctx: TemplateContext): string | undefined => {
  const f = ctx.facts;
  const parts: string[] = [];
  if (f.places !== undefined) parts.push(`${f.places} Plätze`);
  if (f.costs) parts.push(f.costs);
  return parts.length ? parts.join(', ') : undefined;
};

const whenDe = (ctx: TemplateContext): string | undefined =>
  ctx.facts.date
    ? bannerWhenDe(ctx.facts.date, ctx.facts.startTime, effectiveEnd(ctx))
    : undefined;

const titleEn = (ctx: DraftContext): string => ctx.ai.titleEn;
const shortEn = (ctx: DraftContext): string => ctx.ai.shortEn;
const bodyEn = (ctx: DraftContext): string => ctx.ai.bodyEn;

/** "am Fr 11.12. um 18 Uhr" / "am Fr 11.12. von 18 bis 21 Uhr" (Facebook prose). */
const whenProseDe = (ctx: TemplateContext): string | undefined => {
  const f = ctx.facts;
  if (!f.date) return undefined;
  const day = `am ${shortWeekdayDateDe(f.date)}`;
  if (!f.startTime) return day;
  const hour = (t: string) => {
    const [h, m] = t.split(':');
    return m === '00' ? String(Number(h)) : `${Number(h)}:${m}`;
  };
  return f.endTime
    ? `${day} von ${hour(f.startTime)} bis ${hour(f.endTime)} Uhr`
    : `${day} um ${hour(f.startTime)} Uhr`;
};

// ---------- Instagram ----------
function instagramDraft(ctx: DraftContext, meetupOn: boolean): ChannelDraft {
  const lines = [hookDe(ctx), '', `✨ ${bodyDe(ctx)}`];
  if (ctx.type === 'event') {
    const when = whenDe(ctx);
    lines.push('');
    if (when) lines.push(`🕓 ${when}`);
    lines.push(`📍 ${ctx.config.location.short}`);
    const pc = placesCostsDe(ctx);
    const ticket = [pc, meetupOn ? 'Anmeldung über Meetup (Link in Bio)' : '']
      .filter(Boolean)
      .join(', ');
    if (ticket) lines.push(`🎟️ ${ticket}`);
  }
  return {
    textDe: lines.join('\n'),
    textEn: `🇬🇧 ${shortEn(ctx)}`,
    fields: { hashtags: hashtags(ctx) },
  };
}

// ---------- Facebook ----------
function facebookDraft(ctx: DraftContext, meetupOn: boolean): ChannelDraft {
  let de: string;
  if (ctx.type === 'event') {
    const when = whenProseDe(ctx);
    const pc = placesCostsDe(ctx);
    de = `${title(ctx)}${when ? ` ${when}` : ''} im Attraktor. ${bodyDe(ctx)}${pc ? ` ${pc}.` : ''}`;
  } else {
    de = `${hookDe(ctx)} ${bodyDe(ctx)} Kommt vorbei und schaut es euch an!`;
  }
  return {
    textDe: de.replace(/\s+/g, ' ').trim(),
    textEn: `🇬🇧 ${shortEn(ctx)}`,
    fields: { hashtags: hashtags(ctx) },
  };
}

// ---------- Meetup ----------
function meetupDraft(ctx: DraftContext): ChannelDraft {
  const f = ctx.facts;
  const de = [`🔧 Was dich erwartet`, bodyDe(ctx), ''];
  const bullets: string[] = [];
  if (f.audience) bullets.push(`👥 Für: ${f.audience}`);
  if (f.places !== undefined) bullets.push(`🎟️ ${f.places} Plätze`);
  if (f.costs) bullets.push(`💶 ${f.costs}`);
  if (bullets.length) de.push(...bullets);
  const en = [`🔧 What to expect`, bodyEn(ctx)];
  const enBullets: string[] = [];
  if (f.places !== undefined) enBullets.push(`🎟️ ${f.places} spots`);
  if (f.costs && ctx.ai.costsEn) enBullets.push(`💶 ${ctx.ai.costsEn}`);
  if (enBullets.length) en.push('', ...enBullets);
  return {
    textDe: de.join('\n').trim(),
    textEn: en.join('\n').trim(),
    fields: { title: `${title(ctx)} / ${titleEn(ctx)}` },
  };
}

// ---------- WordPress ----------
function wordpressDraft(ctx: DraftContext): ChannelDraft {
  const intro = hookDe(ctx);
  const de = `${intro}\n\n${bodyDe(ctx)}`.trim();
  return {
    textDe: de,
    textEn: bodyEn(ctx),
    fields: {
      title: title(ctx),
      titleEn: titleEn(ctx),
      ...(ctx.facts.costs && ctx.ai.costsEn ? { costsEn: ctx.ai.costsEn } : {}),
    },
  };
}

// ---------- Wiki ----------
function wikiDraft(ctx: DraftContext): ChannelDraft {
  return {
    textDe: bodyDe(ctx),
    textEn: '',
    fields: {},
  };
}

/** Creates the editable drafts for the given channels. */
export function buildDrafts(
  ctx: DraftContext,
  channels: ChannelId[],
): Partial<Record<ChannelId, ChannelDraft>> {
  const out: Partial<Record<ChannelId, ChannelDraft>> = {};
  const meetupOn = channels.includes('meetup');
  for (const ch of channels) {
    switch (ch) {
      case 'instagram':
        out[ch] = instagramDraft(ctx, meetupOn);
        break;
      case 'facebook':
        out[ch] = facebookDraft(ctx, meetupOn);
        break;
      case 'meetup':
        out[ch] = meetupDraft(ctx);
        break;
      case 'wordpress':
        out[ch] = wordpressDraft(ctx);
        break;
      case 'wiki':
        out[ch] = wikiDraft(ctx);
        break;
    }
  }
  return out;
}

// ================= Final outputs =================

export interface CopyField {
  key: string;
  label: string;
  value: string;
}

/** Instagram caption: DE text, EN short version, hashtags. */
export function instagramCaption(draft: ChannelDraft): string {
  return [
    draft.textDe.trim(),
    draft.textEn.trim(),
    draft.fields['hashtags'] ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Short Instagram teaser for the card and the DM summary: the ✨ body
 * paragraph (not the hook, which often quotes the title already).
 */
export function instagramExcerpt(draft: ChannelDraft, max = 140): string {
  const paragraphs = draft.textDe.split(/\n{2,}/).map((p) => p.trim());
  const body =
    paragraphs.find((p) => p.startsWith('✨')) ??
    paragraphs[1] ??
    paragraphs[0] ??
    '';
  const flat = body
    .replace(/^✨\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function facebookText(draft: ChannelDraft, links: Links): string {
  const parts = [draft.textDe.trim()];
  if (links.meetup) parts.push(`Anmeldung: ${links.meetup}`);
  if (draft.textEn.trim()) parts.push(draft.textEn.trim());
  return parts.join('\n\n');
}

export function meetupDescription(
  ctx: TemplateContext,
  draft: ChannelDraft,
): string {
  const loc = ctx.config.location;
  return [
    draft.textDe.trim(),
    `🇬🇧 English\n${draft.textEn.trim()}`,
    `📍 ${loc.full}\n🚉 ${loc.transit}\n💬 ${ctx.config.contact}`,
  ].join('\n\n');
}

export function meetupCopyFields(
  ctx: TemplateContext,
  draft: ChannelDraft,
  category?: string | null,
): CopyField[] {
  const f = ctx.facts;
  const end = effectiveEnd(ctx);
  return [
    {
      key: 'title',
      label: 'Titel',
      value: draft.fields['title'] ?? title(ctx),
    },
    { key: 'date', label: 'Datum', value: f.date ? fullDateDe(f.date) : '' },
    {
      key: 'time',
      label: 'Uhrzeit',
      value: f.startTime ? `${f.startTime}${end ? ` – ${end}` : ''}` : '',
    },
    { key: 'location', label: 'Ort', value: ctx.config.location.full },
    {
      key: 'places',
      label: 'Teilnehmer max.',
      value: f.places !== undefined ? String(f.places) : '',
    },
    {
      key: 'description',
      label: 'Beschreibung',
      value: meetupDescription(ctx, draft),
    },
    { key: 'category', label: 'Kategorie', value: category ?? '' },
  ];
}

export function instagramCopyFields(draft: ChannelDraft): CopyField[] {
  return [
    {
      key: 'text',
      label: 'Text DE + EN',
      value: [draft.textDe.trim(), draft.textEn.trim()]
        .filter(Boolean)
        .join('\n\n'),
    },
    {
      key: 'hashtags',
      label: 'Hashtags',
      value: draft.fields['hashtags'] ?? '',
    },
  ];
}

export function facebookCopyFields(
  draft: ChannelDraft,
  links: Links,
): CopyField[] {
  return [
    {
      key: 'text',
      label: 'Text DE + EN',
      value: facebookText({ ...draft, fields: draft.fields }, links),
    },
    {
      key: 'hashtags',
      label: 'Hashtags',
      value: draft.fields['hashtags'] ?? '',
    },
  ];
}

const escHtml = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

/** WordPress post HTML: intro, Wo/Wann/Was, description, Meetup link, English section. */
export function wordpressContent(
  ctx: TemplateContext,
  draft: ChannelDraft,
  links: Links,
): string {
  const f = ctx.facts;
  const [intro, ...rest] = draft.textDe.trim().split(/\n{2,}/);
  const when = f.date
    ? bannerWhenDe(f.date, f.startTime, effectiveEnd(ctx))
    : '';
  const what = [
    f.places !== undefined ? `${f.places} Plätze` : undefined,
    f.costs,
  ].filter(Boolean);
  const block = [
    `<strong>Wo:</strong> ${escHtml(ctx.config.location.full)}`,
    `<strong>Wann:</strong> ${escHtml(when)}`,
    `<strong>Was:</strong> ${escHtml([title(ctx), ...what].join(' · '))}`,
  ].join('<br>\n');
  const whenEnTxt = f.date
    ? `${dateEn(f.date)}${f.startTime ? `, ${timeRangeEn(f.startTime, effectiveEnd(ctx))}` : ''}`
    : '';
  const whatEn = [
    draft.fields['titleEn'] ?? title(ctx),
    f.places !== undefined ? `${f.places} spots` : undefined,
    f.costs ? draft.fields['costsEn'] : undefined,
  ].filter(Boolean);
  const blockEn = [
    `<strong>Where:</strong> ${escHtml(ctx.config.location.full)}`,
    `<strong>When:</strong> ${escHtml(whenEnTxt)}`,
    `<strong>What:</strong> ${escHtml(whatEn.join(' · '))}`,
  ].join('<br>\n');
  const html = [
    paragraphs(intro ?? ''),
    `<p>${block}</p>`,
    paragraphs(rest.join('\n\n')),
    links.meetup
      ? `<p>Anmeldung über Meetup: <a href="${escHtml(links.meetup)}">${escHtml(links.meetup)}</a></p>`
      : '',
    '<h3>English</h3>',
    `<p>${blockEn}</p>`,
    paragraphs(draft.textEn),
    links.meetup
      ? `<p>Sign up on Meetup: <a href="${escHtml(links.meetup)}">${escHtml(links.meetup)}</a></p>`
      : '',
  ];
  return html.filter(Boolean).join('\n');
}

/**
 * WordPress post title. The REST API stores it as HTML (and editors may post
 * unfiltered HTML), so tags are dropped and the rest is escaped.
 */
export function wordpressTitle(
  ctx: TemplateContext,
  draft: ChannelDraft,
): string {
  const raw = draft.fields['title'] ?? title(ctx);
  return raw
    .replace(/<[^>]*>?/g, '')
    .replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;'))
    .trim();
}

const WIKI_ENTITIES: Record<string, string> = {
  '{': '&#123;',
  '}': '&#125;',
  '[': '&#91;',
  ']': '&#93;',
  '|': '&#124;',
  '<': '&lt;',
  '>': '&gt;',
};

/**
 * Escapes member text for wikitext: no templates, links, tags, signatures,
 * magic words or bold/italic; list/heading/indent markers at a line start
 * are neutralised. Normal sentences stay readable in the page source.
 */
export function wikiEscape(text: string): string {
  return text
    .replace(/[{}[\]|<>]/g, (c) => WIKI_ENTITIES[c]!)
    .replace(/'(?=')/g, '&#39;') // bold/italic
    .replace(/_(?=_)/g, '&#95;') // __NOTOC__ etc.
    .replace(/~(?=~~)/g, '&#126;') // signatures
    .split('\n')
    .map((line) =>
      line
        .replace(/^([*#:;= ])/, (c) => `&#${c.charCodeAt(0)};`)
        .replace(/^-{4,}/, (d) => `&#45;${d.slice(1)}`),
    )
    .join('\n');
}

/** Wiki page title: "Termin:<Titel> <YYYY-MM-DD>". */
export function wikiPageTitle(ctx: TemplateContext): string {
  const clean = title(ctx)
    .replace(/[#<>[\]|{}_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Termin:${clean} ${ctx.facts.date ?? ''}`.trim();
}

/** Wiki page content with the real {{Termin}} signature, German only. */
export function wikiContent(
  ctx: TemplateContext,
  draft: ChannelDraft,
  links: Links & { meetupId?: string | null },
): string {
  const f = ctx.facts;
  const start = f.date && f.startTime ? wikiDateTime(f.date, f.startTime) : '';
  const endTime = effectiveEnd(ctx);
  // An end at or before the start (e.g. 22:00 + 3 h) is on the next day.
  const endDate =
    f.date && f.startTime && endTime && endTime <= f.startTime
      ? addDays(f.date, 1)
      : f.date;
  const end = endDate && endTime ? wikiDateTime(endDate, endTime) : '';
  const website = links.website?.replace(/[\s|{}[\]<>]/g, '') ?? '';
  const params = [
    `|date=${start}`,
    `|enddate=${end}`,
    `|title=${wikiEscape(title(ctx))}`,
    `|url=${website}`,
    `|visible=Yes`,
  ];
  if (links.meetupId && /^\d+$/.test(links.meetupId))
    params.push(`|meetupid=${links.meetupId}`);
  return `{{Termin\n${params.join('\n')}\n}}\n\n${wikiEscape(draft.textDe.trim())}\n`;
}
