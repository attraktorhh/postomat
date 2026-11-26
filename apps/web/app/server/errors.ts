import {
  InvalidTransitionError,
  WEB_STATUS_LABELS,
  type ChannelId,
} from '@postomat/core';
import { CHANNEL_NAMES } from '@postomat/templates';

/** Message for a failed form action, in German for invalid status changes. */
export function actionError(e: unknown): string {
  if (e instanceof InvalidTransitionError)
    return `Das geht im Status „${WEB_STATUS_LABELS[e.from]}“ nicht (nicht möglich: ${WEB_STATUS_LABELS[e.to]}).`;
  return e instanceof Error ? e.message : String(e);
}

/** Success text after a web approval, naming the real auto channels. */
export function approvedText(auto: ChannelId[]): string {
  if (!auto.length)
    return 'Freigegeben. Alle Kanäle sind Kopier-Kanäle – trag die Links in der Kopierhilfe ein.';
  const names = auto.map((c) => CHANNEL_NAMES[c]);
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
      : names[0];
  return `Freigegeben. ${list} ${names.length > 1 ? 'werden' : 'wird'} jetzt veröffentlicht.`;
}
