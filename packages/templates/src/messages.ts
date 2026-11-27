import {
  CHANNEL_STATUS_LABELS,
  factsLineDm,
  factsLineShort,
  STATUS_LABELS,
  TEXTS_PENDING,
  type ChannelId,
  type ChannelMode,
  type ChannelPostStatus,
  type CheckResult,
  type PostFacts,
  type PostStatus,
  type PostType,
} from '@postomat/core';

/** A Matrix message with plain-text fallback and HTML body. */
export interface MatrixText {
  body: string;
  html: string;
}

export const CHANNEL_NAMES: Record<ChannelId, string> = {
  wordpress: 'Website',
  wiki: 'Wiki',
  meetup: 'Meetup',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

const CHANNEL_ORDER: ChannelId[] = [
  'wordpress',
  'wiki',
  'meetup',
  'instagram',
  'facebook',
];

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );

// ---------------- DM texts ----------------

export const DM = {
  notMember:
    'Postomat ist nur für Attraktor-Mitglieder. Frag gern ein Mitglied, ob es deinen Beitrag einreicht.',
  help:
    'So funktioniert’s: Erzähl mir in einem Satz, was du vorhast (Event) oder gebaut hast (Projekt). Ich frage nach, was fehlt, und schicke es ans Medienteam.\n\n' +
    'Du musst keine Befehle tippen, schreib einfach, was du willst. Zum Beispiel:\n• „neu“ – neuen Beitrag starten\n• „status“ – deine Beiträge\n• „abbrechen“ – aktuellen Entwurf verwerfen\n• „abschicken“ – Entwurf ans Medienteam schicken\n• „hilfe“ – diese Hilfe\n\n' +
    'Fotos schickst du einfach hier rein. Texte ändern: schreib z. B. „mach den Text kürzer“.',
  submitted: 'Ist beim Medienteam 🙌 Ich melde mich, sobald es online ist.',
  cancelled:
    'Okay, den Entwurf habe ich verworfen. Schreib einfach, wenn du etwas Neues hast.',
  nothingToCancel: 'Du hast gerade keinen offenen Entwurf.',
  nothingToSubmit:
    'Du hast gerade keinen Entwurf zum Abschicken. Erzähl einfach, was du vorhast.',
  notReady: 'Mir fehlt noch etwas, bevor ich es abschicken kann.',
  photoWithoutDraft:
    'Danke für das Foto! Erzähl mir bitte erst kurz, worum es geht, dann schick es noch einmal.',
  photoUnsupported:
    'Das Format kenne ich leider nicht. Schick das Foto bitte als JPEG, PNG oder WebP.',
  photoFailed:
    'Das Foto konnte ich gerade nicht speichern. Versuch es bitte gleich noch einmal.',
  photoTooLarge:
    'Das Foto ist mir zu groß (über 25 MB). Schick es bitte etwas kleiner, zum Beispiel als normales Handyfoto.',
  rueckfrageAck: 'Danke, ich gebe das ans Medienteam weiter.',
  /** Any AI failure (timeout, HTTP error, schema mismatch): nothing changed. */
  aiUnavailable:
    'Ich kann deine Nachricht gerade nicht verarbeiten. Bitte versuch es in ein paar Minuten noch mal.',
  textsPending: TEXTS_PENDING,
  messageTooLong:
    'Deine Nachricht ist sehr lang – fass sie bitte kürzer zusammen.',
  textsFailed: (title: string) =>
    `Die Texte für „${title}“ konnten gerade nicht neu erstellt werden. Das Medienteam versucht es später noch einmal.`,
  confirmCancel: (title: string) =>
    `Deinen Entwurf „${title}“ verwerfen? (ja/nein)`,
  confirmNew: (title: string) =>
    `Du hast schon einen Entwurf „${title}“. Verwerfen und neu anfangen? (ja/nein)`,
  keepGoing: 'Okay, dann machen wir weiter.',
  textsUpdated:
    'Ich habe die Texte angepasst. Antworte „abschicken“ oder ergänze im Browser eine Notiz.',
  noPosts: 'Du hast noch keine Beiträge. Erzähl einfach, was du vorhast!',
  alreadySubmitted: 'Der Beitrag ist schon beim Medienteam.',
} as const;

export function channelListLine(
  channels: Array<{ channel: ChannelId; mode: ChannelMode }>,
): string {
  const names = CHANNEL_ORDER.filter((c) =>
    channels.some((x) => x.channel === c && x.mode !== 'off'),
  ).map((c) => CHANNEL_NAMES[c]);
  return [...names, 'DE + EN'].join(' · ');
}

export function dmSummary(input: {
  type: PostType;
  facts: PostFacts;
  channels: Array<{ channel: ChannelId; mode: ChannelMode }>;
  url: string;
  excerpt?: string;
}): MatrixText {
  const f = input.facts;
  // Projekt: the excerpt already quotes the description, so only the type here.
  const facts = input.type === 'event' ? factsLineDm(f) : 'Projekt';
  const lines = [
    'Super, so schicke ich es ans Medienteam:',
    '',
    `${f.title ?? ''}`,
    facts,
    input.excerpt ? `„${input.excerpt}“` : '',
    channelListLine(input.channels),
    '',
    `Alle Texte ansehen ↗ ${input.url}`,
  ].filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '');
  const html = [
    'Super, so schicke ich es ans Medienteam:',
    `<blockquote><b>${esc(f.title ?? '')}</b><br>${esc(facts)}${
      input.excerpt ? `<br><i>„${esc(input.excerpt)}“</i>` : ''
    }<br>${esc(channelListLine(input.channels))}</blockquote>`,
    `<a href="${esc(input.url)}">Alle Texte ansehen ↗</a>`,
  ].join('<br>');
  return { body: lines.join('\n'), html };
}

export const DM_SUBMIT_HINT =
  'Antworte „abschicken“ oder ergänze im Browser eine Notiz.';

/**
 * DM after approval and the auto channels. Says "online" only when at least
 * one link exists; otherwise (copy channels only, or every auto channel
 * failed) it only confirms the approval.
 */
export function dmPublished(
  title: string,
  links: Array<{ channel: ChannelId; url: string }>,
): string {
  if (!links.length)
    return `👍 Dein Beitrag „${title}“ ist freigegeben. Ich schicke dir die Links, sobald er online ist.`;
  const lines = links.map((l) => `• ${CHANNEL_NAMES[l.channel]}: ${l.url}`);
  return `✅ Dein ${title} ist online!\n${lines.join('\n')}`;
}

export function dmFollowUp(
  title: string,
  channel: ChannelId,
  url: string,
): string {
  return `🔗 ${CHANNEL_NAMES[channel]} zu „${title}“ ist da: ${url}`;
}

export function dmRueckfrage(
  title: string,
  question: string,
  from: string,
): string {
  return `Frage vom Medienteam (@${from}) zu „${title}“:\n${question}\n\nAntworte einfach hier.`;
}

export function dmStatus(
  posts: Array<{ id: number; title: string; status: PostStatus; url: string }>,
): string {
  if (!posts.length) return DM.noPosts;
  const lines = posts.map(
    (p) =>
      `• ${p.title}: ${p.status === 'sammeln' ? 'Entwurf' : memberLabel(p.status)} – ${p.url}`,
  );
  return `Deine Beiträge:\n${lines.join('\n')}`;
}

function memberLabel(status: PostStatus): string {
  switch (status) {
    case 'zur_freigabe':
    case 'aenderung_gewuenscht':
      return 'Beim Medienteam';
    case 'geplant':
      return 'Geplant';
    case 'online':
      return 'Online';
    case 'verworfen':
      return 'Verworfen';
    default:
      return 'Entwurf';
  }
}

export function dmGreeting(name: string): string {
  return `Hi ${name}! Erzähl einfach, was du vorhast oder gemacht hast. Ein Satz reicht.`;
}

// ---------------- #medienteam card ----------------

export interface CardChannel {
  channel: ChannelId;
  mode: ChannelMode;
  status: ChannelPostStatus;
  url?: string | null;
  error?: string | null;
}

export interface CardInput {
  title: string;
  authorUsername: string;
  version: number;
  status: PostStatus;
  approvedBy?: string | null;
  type: PostType;
  facts: PostFacts;
  instagramExcerpt?: string;
  channels: CardChannel[];
  note?: string | null;
  checks: CheckResult[];
  editUrl: string;
}

/** Status part of the card header; the header already carries "vN". */
export function cardStatusLabel(
  input: Pick<CardInput, 'status' | 'approvedBy'>,
): string {
  switch (input.status) {
    case 'geplant':
      return `Freigegeben · @${input.approvedBy ?? '?'}`;
    default:
      return STATUS_LABELS[input.status];
  }
}

export function channelChips(channels: CardChannel[]): string[] {
  const active = channels.filter((c) => c.mode !== 'off');
  const chips: string[] = [];
  const auto = active
    .filter((c) => c.mode === 'auto')
    .map((c) => CHANNEL_NAMES[c.channel]);
  if (auto.length) chips.push(`${auto.join(' + ')}: sofort`);
  for (const c of active.filter((x) => x.mode === 'copy')) {
    if (c.channel === 'meetup') chips.push('Meetup: Kopierhilfe');
    else if (c.channel === 'instagram') chips.push('IG: Kopiervorlage');
    else if (c.channel === 'facebook') chips.push('FB: Kopiervorlage');
    else chips.push(`${CHANNEL_NAMES[c.channel]}: Kopierhilfe`);
  }
  return chips;
}

function channelResult(c: CardChannel): string {
  const label =
    c.status === 'erledigt' && c.channel === 'meetup'
      ? 'Gefunden'
      : CHANNEL_STATUS_LABELS[c.status];
  if (c.status === 'fehler') return `⚠️ ${CHANNEL_NAMES[c.channel]}: Fehler`;
  return `${CHANNEL_NAMES[c.channel]}: ${label}${c.url ? ` – ${c.url}` : ''}`;
}

export function renderCard(input: CardInput): MatrixText {
  const header = `${input.title} · von @${input.authorUsername} · v${input.version}`;
  const status = cardStatusLabel(input);
  const footer = cardFooter(input.status);
  const facts = factsLineShort(input.type, input.facts);
  const chips = channelChips(input.channels);
  const checks = input.checks.map((c) => `${c.ok ? '✓' : '!'} ${c.label}`);
  const approvedPhase = input.status === 'geplant' || input.status === 'online';
  const results = approvedPhase
    ? input.channels.filter((c) => c.mode !== 'off').map(channelResult)
    : [];
  const body = [
    `${header} · ${status}`,
    facts,
    input.instagramExcerpt ? `IG: „${input.instagramExcerpt}“` : '',
    chips.join(' · '),
    input.note ? `Notiz von @${input.authorUsername}: „${input.note}“` : '',
    checks.join(' · '),
    results.length ? results.join('\n') : '',
    `${footer.text ? `${footer.text} · ` : ''}${footer.link} ↗ ${input.editUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = [
    `<b>${esc(input.title)}</b> · von @${esc(input.authorUsername)} · v${input.version} · <b>${esc(status)}</b>`,
    `<b>${esc(facts)}</b>`,
    input.instagramExcerpt ? `<i>IG: „${esc(input.instagramExcerpt)}“</i>` : '',
    chips.map((c) => `<code>${esc(c)}</code>`).join(' '),
    input.note
      ? `<blockquote>Notiz von @${esc(input.authorUsername)}: „${esc(input.note)}“</blockquote>`
      : '',
    checks.map(esc).join(' · '),
    results.length
      ? `<ul>${results.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '',
    `<sub>${footer.text ? `${esc(footer.text)} · ` : ''}<a href="${esc(input.editUrl)}">${esc(footer.link)} ↗</a></sub>`,
  ]
    .filter(Boolean)
    .join('<br>');
  return { body, html };
}

/** Card footer: what the Medienteam can do in the current state. */
function cardFooter(status: PostStatus): { text: string; link: string } {
  switch (status) {
    case 'zur_freigabe':
      return {
        text: '👍 freigeben · im Thread antworten = Änderung',
        link: 'Im Browser bearbeiten',
      };
    case 'aenderung_gewuenscht':
      return {
        text: 'Im Browser ändern und „Erneut zur Freigabe“ klicken',
        link: 'Im Browser bearbeiten',
      };
    default:
      return { text: '', link: 'Im Browser ansehen' };
  }
}

export const THREAD = {
  selfApproval: 'Eigene Beiträge kann man nicht selbst freigeben 🙂',
  outdated: 'Bitte erst die neue Version zur Freigabe stellen.',
  blocked: (reasons: string[]) =>
    `Freigabe nicht möglich: ${reasons.join(' · ')}`,
  changeRequested: (who: string) =>
    `Änderung gewünscht von @${who}. Im Browser bearbeiten und „Erneut zur Freigabe“ klicken.`,
  newVersion: (v: number) => `Neue Version v${v} zur Freigabe.`,
  meetupQuestion: (
    title: string,
    candidates: Array<{ title: string; when: string }>,
  ) =>
    `Ist eins davon das Meetup-Event zu „${title}“?\n${candidates
      .map(
        (c, i) =>
          `${['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i] ?? `${i + 1}.`} ${c.title} (${c.when})`,
      )
      .join('\n')}\n– antworte mit der Zahl oder „nein“`,
  meetupLinked: (url: string) => `Meetup verlinkt: ${url}`,
  meetupDeclined:
    'Okay, ich suche weiter im Feed. Den Link kannst du auch im Browser eintragen.',
};

/** Top-level message after approval and the auto channels. */
export function approvedSummary(input: {
  approver: string;
  channels: CardChannel[];
  copyHelperUrl: string;
}): MatrixText {
  const online = input.channels.filter(
    (c) => c.mode === 'auto' && c.status === 'veroeffentlicht',
  );
  const failed = input.channels.filter(
    (c) => c.mode === 'auto' && c.status === 'fehler',
  );
  const copy = input.channels.filter((c) => c.mode === 'copy');
  const names = (cs: CardChannel[]) => {
    const n = cs.map((c) => CHANNEL_NAMES[c.channel]);
    return n.length <= 1
      ? n.join('')
      : `${n.slice(0, -1).join(', ')} und ${n.at(-1)}`;
  };
  const parts = [`Freigegeben von @${input.approver}.`];
  if (online.length)
    parts.push(
      `${names(online)} ${online.length > 1 ? 'sind' : 'ist'} online.`,
    );
  for (const f of failed) parts.push(`⚠️ ${CHANNEL_NAMES[f.channel]}: Fehler`);
  let body = parts.join(' ');
  let html = esc(body);
  if (copy.length) {
    const ask = `@${input.approver}: ${names(copy)} ${copy.length > 1 ? 'brauchen' : 'braucht'} dich kurz 👉 Kopierhilfe öffnen`;
    body += `\n${ask} ${input.copyHelperUrl}`;
    html += `<br>${esc(ask.replace(/ Kopierhilfe öffnen$/, ''))} <a href="${esc(input.copyHelperUrl)}">Kopierhilfe öffnen</a>`;
  }
  return { body, html };
}
