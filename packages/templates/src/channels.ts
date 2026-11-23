import {
  bannerWhenDe,
  dateEn,
  fullDateDe,
  timeRangeEn,
  type ChannelId,
  wikiDateTime,
} from '@postomat/core';
import {
  costsEn,
  effectiveEnd,
  firstSentences,
  hashtags,
  title,
  type Links,
  type TemplateContext,
} from './context.ts';

/** Editable texts per channel (what the Redaktion edits). */
export interface ChannelDraft {
  textDe: string;
  textEn: string;
  fields: Record<string, string>;
}

const hookDe = (ctx: TemplateContext): string => {
  if (ctx.ai?.hookDe) return ctx.ai.hookDe;
  if (ctx.type === 'projekt')
    return `Frisch aus der Werkstatt: ${title(ctx)}! ✨`;
  return ctx.facts.isWorkshop
    ? `Lust auf „${title(ctx)}“? 🔥`
    : `Kommt vorbei: ${title(ctx)}! 🔥`;
};

const bodyDe = (ctx: TemplateContext): string => {
  if (ctx.ai?.bodyDe) return ctx.ai.bodyDe;
  const f = ctx.facts;
  if (ctx.type === 'projekt') {
    const tricky = f.trickiest
      ? ` Das Kniffligste: ${f.trickiest.replace(/[.!]?$/, '.')}`
      : '';
    return `${firstSentences(f.description)}${tricky}`.trim();
  }
  return firstSentences(f.description) || `${title(ctx)} im Attraktor.`;
};

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

const whenEn = (ctx: TemplateContext): string | undefined => {
  const f = ctx.facts;
  if (!f.date) return undefined;
  return f.startTime
    ? `${dateEn(f.date)}, ${timeRangeEn(f.startTime, effectiveEnd(ctx))}`
    : dateEn(f.date);
};

const titleEn = (ctx: TemplateContext): string => ctx.ai?.titleEn ?? title(ctx);

function shortEn(ctx: TemplateContext, signup = true): string {
  if (ctx.ai?.shortEn) return ctx.ai.shortEn;
  const f = ctx.facts;
  if (ctx.type === 'projekt')
    return `Built at Attraktor: ${titleEn(ctx)}. Drop by and have a look!`;
  const extras = [
    f.places !== undefined ? `${f.places} spots` : undefined,
    costsEn(f.costs),
  ].filter(Boolean);
  const when = whenEn(ctx);
  return `Join us${when ? ` on ${when}` : ''} at Attraktor makerspace in Hamburg-Altona: ${titleEn(ctx)}.${
    extras.length ? ` ${extras.join(', ')}.` : ''
  }${signup ? ' Sign up via Meetup.' : ''}`;
}

function bodyEn(ctx: TemplateContext, signup = true): string {
  if (ctx.ai?.bodyEn) return ctx.ai.bodyEn;
  return shortEn(ctx, signup);
}

// ---------- Instagram ----------
function instagramDraft(ctx: TemplateContext): ChannelDraft {
  const lines = [hookDe(ctx), '', `✨ ${bodyDe(ctx)}`];
  if (ctx.type === 'event') {
    const when = whenDe(ctx);
    lines.push('');
    if (when) lines.push(`🕓 ${when}`);
    lines.push(`📍 ${ctx.config.location.short}`);
    const pc = placesCostsDe(ctx);
    lines.push(`🎟️ ${pc ? `${pc}, ` : ''}Anmeldung über Meetup (Link in Bio)`);
  }
  return {
    textDe: lines.join('\n'),
    textEn: `🇬🇧 ${shortEn(ctx)}`,
    fields: { hashtags: hashtags(ctx) },
  };
}

// ---------- Facebook ----------
function facebookDraft(ctx: TemplateContext): ChannelDraft {
  let de: string;
  if (ctx.type === 'event') {
    const when = whenDe(ctx);
    const pc = placesCostsDe(ctx);
    de = `${title(ctx)}${when ? ` – ${when}` : ''} im Attraktor. ${bodyDe(ctx)}${pc ? ` ${pc}.` : ''}`;
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
function meetupDraft(ctx: TemplateContext): ChannelDraft {
  const f = ctx.facts;
  const de = [`🔧 Was dich erwartet`, bodyDe(ctx), ''];
  const bullets: string[] = [];
  if (f.isWorkshop) bullets.push('✅ Keine Vorkenntnisse nötig');
  if (f.audience) bullets.push(`👥 Für: ${f.audience}`);
  if (f.places !== undefined) bullets.push(`🎟️ ${f.places} Plätze`);
  if (f.costs) bullets.push(`💶 ${f.costs}`);
  if (bullets.length) de.push(...bullets);
  const en = [`🔧 What to expect`, bodyEn(ctx, false)];
  const enBullets: string[] = [];
  if (f.places !== undefined) enBullets.push(`🎟️ ${f.places} spots`);
  const c = costsEn(f.costs);
  if (c) enBullets.push(`💶 ${c}`);
  if (enBullets.length) en.push('', ...enBullets);
  return {
    textDe: de.join('\n').trim(),
    textEn: en.join('\n').trim(),
    // Without AI there is no English title; the Medienteam adds it in the editor.
    fields: {
      title: ctx.ai?.titleEn ? `${title(ctx)} / ${ctx.ai.titleEn}` : title(ctx),
    },
  };
}

// ---------- WordPress ----------
function wordpressDraft(ctx: TemplateContext): ChannelDraft {
  const intro = hookDe(ctx);
  const de =
    `${intro}\n\n${ctx.ai?.bodyDe ?? ctx.facts.description ?? ''}`.trim();
  return {
    textDe: de,
    textEn: bodyEn(ctx),
    fields: { title: title(ctx), titleEn: titleEn(ctx) },
  };
}

// ---------- Wiki ----------
function wikiDraft(ctx: TemplateContext): ChannelDraft {
  return {
    textDe: ctx.ai?.bodyDe ?? ctx.facts.description ?? '',
    textEn: '',
    fields: {},
  };
}

/** Creates the editable drafts for the given channels. */
export function buildDrafts(
  ctx: TemplateContext,
  channels: ChannelId[],
): Partial<Record<ChannelId, ChannelDraft>> {
  const out: Partial<Record<ChannelId, ChannelDraft>> = {};
  for (const ch of channels) {
    switch (ch) {
      case 'instagram':
        out[ch] = instagramDraft(ctx);
        break;
      case 'facebook':
        out[ch] = facebookDraft(ctx);
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
    costsEn(f.costs),
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

export function wordpressTitle(
  ctx: TemplateContext,
  draft: ChannelDraft,
): string {
  return draft.fields['title'] ?? title(ctx);
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
  const end = f.date && endTime ? wikiDateTime(f.date, endTime) : '';
  const params = [
    `|date=${start}`,
    `|enddate=${end}`,
    `|title=${title(ctx).replace(/\|/g, '-')}`,
    `|url=${links.website ?? ''}`,
    `|visible=Yes`,
  ];
  if (links.meetupId) params.push(`|meetupid=${links.meetupId}`);
  return `{{Termin\n${params.join('\n')}\n}}\n\n${draft.textDe.trim()}\n`;
}
