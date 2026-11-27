/**
 * Form schemas for the web actions (pure, no env, no DB). The enums from
 * @postomat/core are the source of truth for the allowed values.
 */
import { z } from 'zod';
import { BANNER_COLORS, CHANNELS, CONSENTS } from '@postomat/core';
import type { AutoChannel } from '@postomat/workflow';

/** German names of the form fields, for error messages. */
const FIELD_LABELS: Record<string, string> = {
  photoId: 'Foto',
  color: 'Banner-Farbe',
  channel: 'Kanal',
  version: 'Version',
  consent: 'Einwilligung',
  category: 'Meetup-Kategorie',
  endTime: 'Ende',
  url: 'Link',
  question: 'Frage',
  comment: 'Kommentar',
  note: 'Notiz',
  member: 'Mitglieder-Räume',
  medienteam: 'Medienteam-Raum',
};

/**
 * German message for zod's built-in checks, naming the field, scoped to these
 * parses only. These values come from buttons and selects, so an invalid one
 * means a stale or tampered page. Messages set on a schema (e.g.
 * `.min(1, '…')`) win over this.
 */
const fieldError: z.core.$ZodErrorMap = (issue) => {
  const label = FIELD_LABELS[String(issue.path?.[0] ?? '')] ?? 'Eingabe';
  return `${label}: ungültiger Wert. Bitte lade die Seite neu.`;
};

const STALE_ACTION =
  'Diese Aktion ist nicht (mehr) möglich. Bitte lade die Seite neu.';

type FormResult<T> =
  { success: true; data: T } | { success: false; error: string };

/**
 * Validates form fields against a schema. Invalid input becomes a German
 * message for the page instead of an exception.
 */
export function parseForm<T extends z.ZodType>(
  schema: T,
  input: Record<string, unknown>,
): FormResult<z.output<T>> {
  const result = schema.safeParse(input, { error: fieldError });
  if (result.success) return { success: true, data: result.data };
  const issue = result.error.issues[0];
  if (issue?.path[0] === 'intent')
    return { success: false, error: STALE_ACTION };
  return { success: false, error: issue?.message ?? 'Ungültige Eingabe.' };
}

/** Single-value form fields; repeated fields keep the last value. */
export function formFields(form: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(form);
}

/** A text field, trimmed; a missing field reads as empty. */
const text = z.string().trim().default('');
const channel = z.enum(CHANNELS);
const AUTO_CHANNELS = [
  'wordpress',
  'wiki',
] as const satisfies readonly AutoChannel[];

/** All actions of the Redaktion post page, keyed by `intent`. */
export const postActionSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('save_text'),
    channel,
    // A field that was not sent stays unchanged; texts keep their whitespace.
    textDe: z.string().optional(),
    textEn: z.string().optional(),
    hashtags: z.string().trim().optional(),
    title: z.string().trim().optional(),
    titleEn: z.string().trim().optional(),
  }),
  z.object({ intent: z.literal('banner_color'), color: z.enum(BANNER_COLORS) }),
  z.object({ intent: z.literal('meetup_category'), category: text }),
  z.object({
    intent: z.literal('consent'),
    photoId: z.coerce.number().int().positive(),
    consent: z.enum(CONSENTS),
  }),
  z.object({
    intent: z.literal('facts'),
    endTime: text.transform((v) => v || undefined),
    isWorkshop: z
      .string()
      .optional()
      .transform((v) => v === 'on'),
  }),
  z.object({
    intent: z.literal('approve'),
    // The version the reviewer saw; anything unusable never matches.
    version: z.coerce.number().int().positive().catch(-1),
  }),
  z.object({
    intent: z.literal('request_change'),
    comment: text.transform((v) => v || undefined),
  }),
  z.object({ intent: z.literal('resubmit') }),
  z.object({ intent: z.literal('discard') }),
  z.object({
    intent: z.literal('ask'),
    question: text.pipe(z.string().min(1, 'Bitte eine Frage eingeben.')),
  }),
  z.object({ intent: z.literal('retry'), channel: z.enum(AUTO_CHANNELS) }),
  z.object({ intent: z.literal('retry_texts') }),
  z.object({
    intent: z.literal('suggestion'),
    apply: z
      .string()
      .optional()
      .transform((v) => v === 'yes'),
  }),
  z.object({ intent: z.literal('link'), channel, url: text }),
  z.object({ intent: z.literal('skip'), channel }),
]);

/** Copy helper: enter the published link or skip the channel. */
export const copyActionSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('link'), url: text }),
  z.object({ intent: z.literal('skip') }),
]);

/** The author's note when sending a post to the Medienteam. */
export const submitSchema = z.object({
  note: z
    .string()
    .default('')
    .transform((v) => v.slice(0, 2000)),
});

/** Room settings (admin); `member` is a repeated checkbox field. */
export const roomSettingsSchema = z.object({
  member: z
    .array(z.string().trim().min(1))
    .min(1, 'Bitte mindestens einen Mitglieder-Raum wählen.'),
  medienteam: text.transform((v) => v || null),
});
