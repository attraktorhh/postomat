import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { Alert, Button } from '@heroui/react';
import type { ChannelId } from '@postomat/core';
import { COPY_IMAGE_FORMAT } from '@postomat/channel-copy';
import { setChannelLink, skipChannel } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';
import { loadPostView } from '../server/views.server';
import { Shell } from '../components/shell';
import { CopyFields } from '../components/copy-button';
import { ChannelStatus } from '../components/status';

const COPY_CHANNELS: ChannelId[] = ['meetup', 'instagram', 'facebook'];
const TITLES: Record<string, string> = {
  meetup: 'Meetup-Kopierhilfe',
  instagram: 'Instagram-Kopiervorlage',
  facebook: 'Facebook-Kopiervorlage',
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  const channel = params['channel'] as ChannelId;
  if (!COPY_CHANNELS.includes(channel))
    throw new Response('Nicht gefunden', { status: 404 });
  const view = await loadPostView(Number(params['id']));
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
  const channel = params['channel'] as ChannelId;
  const form = await request.formData();
  try {
    if (form.get('intent') === 'skip') {
      await skipChannel(deps, id, channel, user.username);
      return { ok: 'Übersprungen.' };
    }
    await setChannelLink(
      deps,
      id,
      channel,
      String(form.get('url') ?? ''),
      user.username,
    );
    return { ok: 'Link eingetragen.' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export default function CopyHelper() {
  const { user, view, channel } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const ch = view.channels.find((c) => c.channel === channel);
  const format = COPY_IMAGE_FORMAT[channel];
  const others = view.channels.filter(
    (c) => c.mode === 'copy' && COPY_CHANNELS.includes(c.channel),
  );
  if (!ch || ch.mode === 'off') {
    return (
      <Shell user={user}>
        <p>Dieser Kanal ist für den Beitrag aus.</p>
      </Shell>
    );
  }
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
      <CopyFields fields={ch.copyFields} />
      <div className="grid grid-cols-1 items-center gap-2 rounded-md border border-[var(--border)] p-2 sm:grid-cols-[8rem_1fr_auto]">
        <b className="text-sm">Bild</b>
        <img
          src={`/banner/${view.post.id}/${format}`}
          alt={`Banner ${format}`}
          className="w-32 rounded"
        />
        <a
          href={`/banner/${view.post.id}/${format}?download=1`}
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
        {ch.status !== 'erledigt' && ch.status !== 'uebersprungen' && (
          <>
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
                placeholder={
                  channel === 'meetup'
                    ? 'Link zum Meetup-Event eintragen'
                    : `Link zum ${channel === 'instagram' ? 'Instagram' : 'Facebook'}-Post einfügen`
                }
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] px-2 py-1 text-sm"
              />
              <Button type="submit" size="sm" variant="primary">
                Link eintragen
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="skip" />
              <Button type="submit" size="sm" variant="tertiary">
                Überspringen
              </Button>
            </Form>
          </>
        )}
      </div>
    </Shell>
  );
}
