import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { Alert, Button } from '@heroui/react';
import { CHANNELS, type ChannelId } from '@postomat/core';
import { COPY_IMAGE_FORMAT } from '@postomat/channel-copy';
import { CHANNEL_NAMES } from '@postomat/templates';
import {
  getChannel,
  isDbId,
  setChannelLink,
  skipChannel,
} from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { actionError } from '../server/errors';
import { getDeps } from '../server/deps.server';
import { copyActionSchema, formFields, parseForm } from '../server/forms';
import { loadPostView } from '../server/views.server';
import { Shell } from '../components/shell';
import { CopyFields } from '../components/copy-button';
import { ChannelStatus } from '../components/status';
import { bannerSrc } from '../urls';

/**
 * Copy helper for every channel in copy mode: Meetup, Instagram, Facebook and
 * also WordPress or the wiki when they fell back to copy (no credentials).
 */
const TITLES: Record<ChannelId, string> = {
  meetup: 'Meetup-Kopierhilfe',
  instagram: 'Instagram-Kopiervorlage',
  facebook: 'Facebook-Kopiervorlage',
  wordpress: 'Website-Kopiervorlage',
  wiki: 'Wiki-Kopiervorlage',
};

function channelParam(raw: string | undefined): ChannelId {
  if (!CHANNELS.includes(raw as ChannelId))
    throw new Response('Nicht gefunden', { status: 404 });
  return raw as ChannelId;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  const channel = channelParam(params['channel']);
  const id = Number(params['id']);
  if (!isDbId(id)) throw new Response('Nicht gefunden', { status: 404 });
  const view = await loadPostView(id);
  return {
    user: { username: user.username, roles: user.roles },
    view,
    channel,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  const deps = await getDeps();
  const id = Number(params['id']);
  const channel = channelParam(params['channel']);
  if (!isDbId(id)) throw new Response('Nicht gefunden', { status: 404 });
  const parsed = parseForm(
    copyActionSchema,
    formFields(await request.formData()),
  );
  if (!parsed.success) return { error: parsed.error };
  // Only copy channels are handled here; auto channels are published (or
  // retried) on the post page, so a crafted POST cannot skip them.
  const row = await getChannel(deps.db, id, channel);
  if (!row || row.mode !== 'copy')
    return { error: `${CHANNEL_NAMES[channel]} ist kein Kopier-Kanal.` };
  try {
    if (parsed.data.intent === 'skip') {
      await skipChannel(deps, id, channel, user.username);
      return { ok: 'Übersprungen.' };
    }
    await setChannelLink(deps, id, channel, parsed.data.url, user.username);
    return { ok: 'Link eingetragen.' };
  } catch (e) {
    return { error: actionError(e) };
  }
}

export default function CopyHelper() {
  const { user, view, channel } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = (intent: string) =>
    nav.state === 'submitting' && nav.formData?.get('intent') === intent;
  const ch = view.channels.find((c) => c.channel === channel);
  const format = COPY_IMAGE_FORMAT[channel];
  const others = view.channels.filter((c) => c.mode === 'copy');
  if (!ch || ch.mode !== 'copy') {
    return (
      <Shell user={user}>
        <Link to={`/redaktion/${view.post.id}`} className="text-sm underline">
          ← {view.post.title}
        </Link>
        <p>
          {!ch || ch.mode === 'off'
            ? 'Dieser Kanal ist für den Beitrag aus.'
            : 'Dieser Kanal wird automatisch veröffentlicht. Den Stand siehst du auf der Beitragsseite.'}
        </p>
      </Shell>
    );
  }
  const done = ch.status === 'erledigt' || ch.status === 'uebersprungen';
  // Links and skips are refused before approval (workflow rule).
  const approved =
    view.post.status === 'geplant' || view.post.status === 'online';
  const linkedAt = ch.linkedAt
    ? new Date(ch.linkedAt).toLocaleTimeString('de-DE', {
        timeZone: 'Europe/Berlin',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
  return (
    <Shell user={user}>
      <Link to={`/redaktion/${view.post.id}`} className="text-sm underline">
        ← {view.post.title}
      </Link>
      <nav className="flex flex-wrap gap-3 text-sm">
        {others.map((o) => (
          <Link
            key={o.channel}
            to={`/redaktion/${view.post.id}/${o.channel}`}
            className={
              o.channel === channel ? 'font-semibold underline' : 'underline'
            }
          >
            {o.name}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{TITLES[channel]}</h1>
        {channel === 'meetup' && (
          <a
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--accent-foreground)]"
            href={view.meetupGroupUrl}
            target="_blank"
            rel="noreferrer"
          >
            Meetup öffnen ↗
          </a>
        )}
      </div>
      {channel === 'meetup' && (
        <p className="text-sm text-[var(--muted)]">
          Tipp: In Meetup „Event kopieren“ beim letzten ähnlichen Event wählen,
          dann nur die Felder unten ersetzen.
        </p>
      )}
      {result && 'error' in result && result.error && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{result.error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {result && 'ok' in result && result.ok && (
        <Alert status="success">
          <Alert.Content>
            <Alert.Description>{result.ok}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <CopyFields fields={ch.copyFields} />
      <div className="grid grid-cols-1 items-center gap-2 rounded-md border border-[var(--border)] p-2 sm:grid-cols-[8rem_1fr_auto]">
        <b className="text-sm">Bild</b>
        <img
          src={bannerSrc(view.post.id, format, view.bannerIds[format])}
          alt={`Banner ${format}`}
          className="w-32 rounded"
        />
        <a
          href={bannerSrc(view.post.id, format, view.bannerIds[format], true)}
          className="rounded-md border border-[var(--border)] px-3 py-1 text-sm"
        >
          {channel === 'meetup' ? 'Laden' : 'Bild laden'}
        </a>
      </div>

      <div className="grid gap-2 rounded-lg border border-[var(--accent)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChannelStatus status={ch.status} channel={ch.channel} />
          {ch.url && (
            <a
              href={ch.url}
              className="font-semibold underline [overflow-wrap:anywhere]"
              target="_blank"
              rel="noreferrer"
            >
              {ch.url}
            </a>
          )}
        </div>
        {channel === 'meetup' &&
          ch.status === 'erledigt' &&
          ch.linkedVia === 'ical' && (
            <span className="text-sm text-[var(--muted)]">
              Im iCal-Feed von Meetup erkannt (Titel + Datum passen) ·{' '}
              {linkedAt}
            </span>
          )}
        {channel === 'meetup' && ch.status === 'kopieren' && (
          <span className="text-sm text-[var(--muted)]">
            Warte auf das Event im iCal-Feed …
          </span>
        )}
        {!approved ? (
          <span className="text-sm text-[var(--muted)]">
            Link eintragen und Überspringen gehen erst nach der Freigabe.
          </span>
        ) : ch.status === 'uebersprungen' ? null : done ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-[var(--muted)]">
              Link ändern
            </summary>
            <LinkForm
              channel={channel}
              pending={busy('link')}
              defaultValue={ch.url ?? ''}
            />
          </details>
        ) : (
          <>
            <LinkForm channel={channel} pending={busy('link')} />
            <Form method="post">
              <input type="hidden" name="intent" value="skip" />
              <Button
                type="submit"
                size="sm"
                variant="tertiary"
                isPending={busy('skip')}
              >
                Überspringen
              </Button>
            </Form>
          </>
        )}
      </div>
    </Shell>
  );
}

function LinkForm({
  channel,
  pending,
  defaultValue,
}: {
  channel: ChannelId;
  pending: boolean;
  defaultValue?: string;
}) {
  return (
    <Form method="post" className="flex flex-wrap gap-2">
      <input type="hidden" name="intent" value="link" />
      <label htmlFor="url" className="sr-only">
        Link
      </label>
      <input
        id="url"
        name="url"
        type="url"
        required
        defaultValue={defaultValue}
        placeholder={
          channel === 'meetup'
            ? 'Link zum Meetup-Event eintragen'
            : `Link zum ${CHANNEL_NAMES[channel]}-Post einfügen`
        }
        className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm"
      />
      <Button type="submit" size="sm" variant="primary" isPending={pending}>
        Link eintragen
      </Button>
    </Form>
  );
}
