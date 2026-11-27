import type {
  ChannelId,
  ChannelPostSnapshot,
  PhotoSnapshot,
  PostSnapshot,
} from './types.ts';
import { berlinToInstant } from './time.ts';
import { missingRequiredFields } from './fields.ts';

const CHANNEL_LABELS: Record<ChannelId, string> = {
  wordpress: 'Website',
  wiki: 'Wiki',
  meetup: 'Meetup',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

export type CheckLevel = 'block' | 'warn';

export interface CheckResult {
  id: string;
  level: CheckLevel;
  ok: boolean;
  /** German label shown in the card and the Redaktion. */
  label: string;
}

export interface CheckInput {
  post: PostSnapshot;
  channels: ChannelPostSnapshot[];
  photos: PhotoSnapshot[];
  now: Date;
  /** Username of the person who wants to approve (optional for display). */
  approverUsername?: string;
  /** Meetup category selected in the Redaktion. */
  meetupCategory?: string | null;
}

const countHashtags = (s: string) =>
  (s.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

export function runChecks(input: CheckInput): CheckResult[] {
  const { post, channels, photos, now } = input;
  const results: CheckResult[] = [];
  const active = channels.filter((c) => c.mode !== 'off');

  if (post.type === 'event') {
    const { date, startTime } = post.facts;
    const future =
      !!date &&
      berlinToInstant(date, startTime ?? '00:00').getTime() > now.getTime();
    results.push({
      id: 'date_future',
      level: 'block',
      ok: future,
      label: future
        ? 'Datum in der Zukunft'
        : 'Datum liegt nicht in der Zukunft',
    });
  }

  const missing = missingRequiredFields(
    post.type,
    post.facts,
    photos.filter((p) => p.kind === 'photo').length,
  );
  results.push({
    id: 'required_fields',
    level: 'block',
    ok: missing.length === 0,
    label:
      missing.length === 0
        ? 'Pflichtangaben vollständig'
        : `Es fehlt: ${missing.join(', ')}`,
  });

  const userPhotos = photos.filter((p) => p.kind === 'photo');
  const blockedPhoto = userPhotos.find((p) => p.consent !== 'frei');
  results.push({
    id: 'photo_consent',
    level: 'block',
    ok: !blockedPhoto,
    label: blockedPhoto
      ? blockedPhoto.consent === 'nur_intern'
        ? 'Foto ist nur intern'
        : 'Foto: Einwilligung fehlt'
      : userPhotos.length
        ? 'Foto frei verwendbar'
        : 'Kein Foto (Banner ohne Foto)',
  });

  if (input.approverUsername !== undefined) {
    const differs = input.approverUsername !== post.authorUsername;
    results.push({
      id: 'not_author',
      level: 'block',
      ok: differs,
      label: differs
        ? 'Autor*in ≠ Freigebende'
        : 'Eigene Beiträge kann man nicht selbst freigeben',
    });
  }

  if (post.textsCurrent !== undefined)
    results.push({
      id: 'texts_current',
      level: 'block',
      ok: post.textsCurrent,
      label: post.textsCurrent
        ? 'Texte passen zu den Angaben'
        : post.textsFailed
          ? 'Texte passen noch nicht zu den Angaben – oben „Erneut versuchen“'
          : 'Texte passen noch nicht zu den Angaben (werden neu erstellt)',
    });

  // Rewrites keep texts the Redaktion edited by hand; someone has to check
  // them after a fact change (saving the text clears this).
  const stale = active.filter((c) => c.factsStale);
  if (stale.length)
    results.push({
      id: 'hand_edited_stale',
      level: 'block',
      ok: false,
      label: `Von Hand bearbeitete Texte prüfen, die Angaben wurden danach geändert: ${stale.map((c) => CHANNEL_LABELS[c.channel]).join(', ')}`,
    });

  const missingEn = active.filter(
    (c) => c.channel !== 'wiki' && !c.textEn.trim(),
  );
  results.push({
    id: 'en_text',
    level: 'warn',
    ok: missingEn.length === 0,
    label:
      missingEn.length === 0
        ? 'EN-Text vorhanden'
        : `EN-Text fehlt: ${missingEn.map((c) => CHANNEL_LABELS[c.channel]).join(', ')}`,
  });

  if (active.some((c) => c.channel === 'meetup')) {
    const ok = !!input.meetupCategory;
    results.push({
      id: 'meetup_category',
      level: 'warn',
      ok,
      label: ok ? 'Meetup-Kategorie gesetzt' : 'Meetup-Kategorie fehlt',
    });
  }

  const title = post.facts.title ?? '';
  results.push({
    id: 'title_length',
    level: 'warn',
    ok: title.length <= 80,
    label:
      title.length <= 80
        ? 'Titel ≤ 80 Zeichen'
        : `Titel ist ${title.length} Zeichen lang (max. 80)`,
  });

  const ig = active.find((c) => c.channel === 'instagram');
  if (ig) {
    const caption = `${ig.textDe}\n\n${ig.textEn}\n\n${ig.fields['hashtags'] ?? ''}`;
    const tags = countHashtags(caption);
    const ok = caption.length <= 2200 && tags <= 8;
    results.push({
      id: 'instagram_caption',
      level: 'warn',
      ok,
      label: ok
        ? 'Instagram-Text passt (≤ 2200 Zeichen, ≤ 8 Hashtags)'
        : `Instagram: ${caption.length} Zeichen, ${tags} Hashtags (max. 2200 / 8)`,
    });
  }
  return results;
}

export const blockingFailures = (checks: CheckResult[]): CheckResult[] =>
  checks.filter((c) => c.level === 'block' && !c.ok);
