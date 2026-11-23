import { useState } from 'react';
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { Alert, Button, Tabs, TextArea } from '@heroui/react';
import {
  BANNER_COLORS,
  CONSENT_LABELS,
  CONSENTS,
  type BannerColor,
  type ChannelId,
  type Consent,
} from '@postomat/core';
import {
  approvePost,
  askMember,
  discardPost,
  editChannelText,
  editFacts,
  requestChange,
  resubmit,
  retryChannel,
  setBannerColor,
  setChannelLink,
  setMeetupCategory,
  setPhotoConsent,
  skipChannel,
} from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';
import { loadPostView, type ChannelView } from '../server/views.server';
import { Shell } from '../components/shell';
import { ChannelStatus, ModeTape, StatusTape } from '../components/status';
import { ChannelPreviews } from '../components/previews';

const SWATCH: Record<BannerColor, [string, string]> = {
  mint: ['#8ff0cf', 'Mint'],
  blau: ['#3d7fc4', 'Blau'],
  rot: ['#b8322b', 'Rot'],
  hellblau: ['#a9cdea', 'Hellblau'],
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  return {
    user: { username: user.username, roles: user.roles },
    view: await loadPostView(Number(params['id'])),
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  const deps = await getDeps();
  const id = Number(params['id']);
  const form = await request.formData();
  const intent = String(form.get('intent'));
  const s = (k: string) => String(form.get(k) ?? '').trim();
  const channel = s('channel') as ChannelId;
  try {
    switch (intent) {
      case 'save_text': {
        const fields: Record<string, string> = {};
        for (const k of ['hashtags', 'title', 'titleEn'])
          if (form.has(k)) fields[k] = s(k);
        await editChannelText(
          deps,
          id,
          channel,
          {
            textDe: String(form.get('textDe') ?? ''),
            textEn: String(form.get('textEn') ?? ''),
            fields,
          },
          user.username,
        );
        return { ok: 'Gespeichert.' };
      }
      case 'banner_color':
        await setBannerColor(
          deps,
          id,
          s('color') as BannerColor,
          user.username,
        );
        return { ok: 'Banner wird neu erzeugt …' };
      case 'meetup_category':
        await setMeetupCategory(deps, id, s('category'), user.username);
        return { ok: 'Meetup-Kategorie gespeichert.' };
      case 'consent':
        await setPhotoConsent(
          deps,
          id,
          Number(s('photoId')),
          s('consent') as Consent,
          user.username,
        );
        return { ok: 'Einwilligung gespeichert.' };
      case 'facts':
        await editFacts(
          deps,
          id,
          {
            endTime: s('endTime') || undefined,
            isWorkshop: form.get('isWorkshop') === 'on',
          },
          user.username,
        );
        return { ok: 'Angaben gespeichert.' };
      case 'approve': {
        const view = await loadPostView(id);
        const d = await approvePost(deps, {
          postId: id,
          approverUsername: user.username,
          approverIsMedienteam: true,
          version: view.post.version,
          via: 'web',
        });
        if (d.kind === 'approve')
          return { ok: 'Freigegeben. Website und Wiki werden veröffentlicht.' };
        if (d.kind === 'self_approval')
          return {
            error: 'Eigene Beiträge kann man nicht selbst freigeben 🙂',
          };
        if (d.kind === 'blocked')
          return {
            error: `Freigabe nicht möglich: ${d.failures.map((f) => f.label).join(' · ')}`,
          };
        if (d.kind === 'outdated_version')
          return { error: 'Bitte erst die neue Version zur Freigabe stellen.' };
        return { error: 'Der Beitrag kann gerade nicht freigegeben werden.' };
      }
      case 'request_change':
        await requestChange(deps, id, user.username, s('comment') || undefined);
        return { ok: 'Änderung angefragt.' };
      case 'resubmit':
        await resubmit(deps, id, user.username);
        return { ok: 'Neue Version zur Freigabe gestellt.' };
      case 'discard':
        await discardPost(deps, id, user.username);
        return { ok: 'Verworfen.' };
      case 'ask':
        if (!s('question')) return { error: 'Bitte eine Frage eingeben.' };
        await askMember(deps, id, s('question'), user.username);
        return { ok: 'Rückfrage ist unterwegs.' };
      case 'retry':
        await retryChannel(
          deps,
          id,
          channel as 'wordpress' | 'wiki',
          user.username,
        );
        return { ok: 'Wird erneut versucht …' };
      case 'link':
        await setChannelLink(deps, id, channel, s('url'), user.username);
        return { ok: 'Link eingetragen.' };
      case 'skip':
        await skipChannel(deps, id, channel, user.username);
        return { ok: 'Übersprungen.' };
      default:
        return { error: `Unbekannte Aktion ${intent}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

type Lang = 'de' | 'en' | 'both';

function ChannelEditor({
  ch,
  editable,
  lang,
}: {
  ch: ChannelView;
  editable: boolean;
  lang: Lang;
}) {
  const nav = useNavigation();
  const showDe = lang !== 'en';
  const showEn = lang !== 'de' && ch.channel !== 'wiki';
  return (
    <Form method="post" className="grid gap-2">
      <input type="hidden" name="intent" value="save_text" />
      <input type="hidden" name="channel" value={ch.channel} />
      {'title' in ch.fields && (
        <label className="grid gap-1 text-sm">
          Titel
          <input
            name="title"
            defaultValue={ch.fields['title']}
            disabled={!editable}
            className="rounded-md border border-[var(--border)] bg-[var(--field-background,transparent)] px-2 py-1"
          />
        </label>
      )}
      <div className={`grid gap-2 ${showDe && showEn ? 'md:grid-cols-2' : ''}`}>
        <label className={`grid gap-1 text-sm ${showDe ? '' : 'hidden'}`}>
          Deutsch
          <TextArea
            name="textDe"
            defaultValue={ch.textDe}
            rows={12}
            disabled={!editable}
            className="w-full font-mono text-sm"
          />
        </label>
        <label className={`grid gap-1 text-sm ${showEn ? '' : 'hidden'}`}>
          English
          <TextArea
            name="textEn"
            defaultValue={ch.textEn}
            rows={12}
            disabled={!editable}
            className="w-full font-mono text-sm"
          />
        </label>
      </div>
      {'hashtags' in ch.fields && (
        <label className="grid gap-1 text-sm">
          Hashtags
          <input
            name="hashtags"
            defaultValue={ch.fields['hashtags']}
            disabled={!editable}
            className="rounded-md border border-[var(--border)] px-2 py-1"
          />
        </label>
      )}
      {editable && (
        <div>
          <Button
            type="submit"
            size="sm"
            variant="primary"
            isPending={nav.state === 'submitting'}
          >
            {ch.name}-Text speichern
          </Button>
        </div>
      )}
    </Form>
  );
}

function ChannelStatusRows({
  view,
}: {
  view: ReturnType<typeof useLoaderData<typeof loader>>['view'];
}) {
  return (
    <div className="grid gap-2">
      {view.channels
        .filter((c) => c.mode !== 'off')
        .map((c) => (
          <div
            key={c.channel}
            className="grid gap-2 rounded-md border border-[var(--border)] p-2 sm:grid-cols-[7rem_1fr_auto] sm:items-center"
          >
            <b>{c.name}</b>
            <span className="min-w-0 text-sm text-[var(--muted)] [overflow-wrap:anywhere]">
              {c.url ? (
                <a
                  href={c.url}
                  className="underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.url}
                </a>
              ) : c.status === 'kopieren' ? (
                c.channel === 'meetup' ? (
                  'Warte auf das Event im iCal-Feed …'
                ) : (
                  'Kopiervorlage – Link nach dem Posten eintragen'
                )
              ) : (
                (c.error ?? '')
              )}
              {c.channel === 'wordpress' && c.status === 'veroeffentlicht'
                ? ' · Kategorie Termine · DE + EN'
                : ''}
              {c.channel === 'meetup' && c.linkedVia === 'ical'
                ? ' · im iCal-Feed erkannt'
                : ''}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <ChannelStatus status={c.status} channel={c.channel} />
              {c.status === 'fehler' && (
                <Form method="post">
                  <input type="hidden" name="intent" value="retry" />
                  <input type="hidden" name="channel" value={c.channel} />
                  <Button type="submit" size="sm" variant="danger">
                    Erneut versuchen
                  </Button>
                </Form>
              )}
              {c.mode === 'copy' && c.status === 'kopieren' && (
                <Link
                  to={`/redaktion/${view.post.id}/${c.channel}`}
                  className="text-sm underline"
                >
                  Kopierhilfe
                </Link>
              )}
            </span>
          </div>
        ))}
    </div>
  );
}

export default function RedaktionPost() {
  const { user, view } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [lang, setLang] = useState<Lang>('de');
  const p = view.post;
  const editable = ['zur_freigabe', 'aenderung_gewuenscht', 'sammeln'].includes(
    p.status,
  );
  const approvedPhase = p.status === 'geplant' || p.status === 'online';
  const active = view.channels.filter((c) => c.mode !== 'off');
  const isAuthor = p.authorUsername === user.username;

  return (
    <Shell user={user} wide>
      <Link to="/redaktion" className="text-sm underline">
        ← Redaktion
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{p.title}</h1>
          <span className="text-sm text-[var(--muted)]">
            {p.factsLine} · von @{p.authorUsername} · v{p.version}
          </span>
        </div>
        <StatusTape status={p.status} version={p.version} />
      </div>
      {p.note && (
        <p className="rounded-md bg-[var(--default)] p-2 text-sm">
          Notiz von @{p.authorUsername}: „{p.note}“
        </p>
      )}
      {p.pendingQuestion && (
        <p className="text-sm">❓ Offene Rückfrage: „{p.pendingQuestion}“</p>
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

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="grid min-w-0 content-start gap-3">
          {approvedPhase && (
            <>
              <h2 className="font-semibold">Status der Kanäle</h2>
              <ChannelStatusRows view={view} />
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Texte</h2>
            <div className="flex gap-1" role="group" aria-label="Sprache">
              {(
                [
                  ['de', 'DE'],
                  ['en', 'EN'],
                  ['both', 'DE + EN nebeneinander'],
                ] as const
              ).map(([k, label]) => (
                <Button
                  key={k}
                  size="sm"
                  variant={lang === k ? 'primary' : 'outline'}
                  aria-pressed={lang === k}
                  onPress={() => setLang(k)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <Tabs className="w-full">
            <Tabs.ListContainer className="overflow-x-auto">
              <Tabs.List aria-label="Kanäle">
                {active.map((c) => (
                  <Tabs.Tab key={c.channel} id={c.channel}>
                    <span className="flex items-center gap-1">
                      {c.name} <ModeTape mode={c.mode} />
                    </span>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {active.map((c) => (
              <Tabs.Panel key={c.channel} id={c.channel} className="pt-3">
                <ChannelEditor ch={c} editable={editable} lang={lang} />
              </Tabs.Panel>
            ))}
          </Tabs>

          <div className="grid gap-3 rounded-md border border-[var(--border)] p-3">
            <div className="flex flex-wrap items-center gap-3">
              <b className="text-sm">Bild-Vorlage</b>
              {BANNER_COLORS.map((c) => (
                <Form method="post" key={c}>
                  <input type="hidden" name="intent" value="banner_color" />
                  <input type="hidden" name="color" value={c} />
                  <button
                    type="submit"
                    aria-label={SWATCH[c][1]}
                    aria-pressed={p.bannerColor === c}
                    title={SWATCH[c][1]}
                    className={`h-8 w-8 rounded-full border-2 ${p.bannerColor === c ? 'border-[var(--foreground)]' : 'border-transparent'}`}
                    style={{ background: SWATCH[c][0] }}
                    disabled={!editable}
                  />
                </Form>
              ))}
              <a
                href={`/banner/${p.id}/4x5?download=1`}
                className="text-sm underline"
              >
                4:5 laden
              </a>
              <a
                href={`/banner/${p.id}/16x9?download=1`}
                className="text-sm underline"
              >
                16:9 laden
              </a>
            </div>
            {view.hasBanner && (
              <img
                src={`/banner/${p.id}/4x5?c=${p.bannerColor}&v=${p.version}`}
                alt="Banner"
                className="w-40 rounded"
              />
            )}
            {active.some((c) => c.channel === 'meetup') && (
              <Form
                method="post"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <input type="hidden" name="intent" value="meetup_category" />
                <label htmlFor="mcat">
                  <b>Meetup-Kategorie</b>
                </label>
                <select
                  id="mcat"
                  name="category"
                  defaultValue={p.meetupCategory ?? ''}
                  className="rounded-md border border-[var(--border)] px-2 py-1"
                >
                  <option value="">– bitte wählen –</option>
                  {view.meetupCategories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="secondary">
                  Speichern
                </Button>
              </Form>
            )}
            {view.photos.map((ph) => (
              <Form
                method="post"
                key={ph.id}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <input type="hidden" name="intent" value="consent" />
                <input type="hidden" name="photoId" value={ph.id} />
                <img
                  src={`/foto/${ph.id}`}
                  alt="Foto"
                  className="h-12 w-12 rounded object-cover"
                />
                <label htmlFor={`consent-${ph.id}`}>Foto-Einwilligung</label>
                <select
                  id={`consent-${ph.id}`}
                  name="consent"
                  defaultValue={ph.consent}
                  className="rounded-md border border-[var(--border)] px-2 py-1"
                >
                  {CONSENTS.map((c) => (
                    <option key={c} value={c}>
                      {CONSENT_LABELS[c]}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="secondary">
                  Speichern
                </Button>
              </Form>
            ))}
            {p.type === 'event' && editable && (
              <Form
                method="post"
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <input type="hidden" name="intent" value="facts" />
                <label htmlFor="endTime">Ende</label>
                <input
                  id="endTime"
                  name="endTime"
                  type="time"
                  defaultValue={p.facts.endTime ?? ''}
                  className="rounded-md border border-[var(--border)] px-2 py-1"
                />
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="isWorkshop"
                    defaultChecked={!!p.facts.isWorkshop}
                  />{' '}
                  Workshop (Kategorie „Workshops“)
                </label>
                <Button type="submit" size="sm" variant="secondary">
                  Speichern
                </Button>
              </Form>
            )}
          </div>
          <h2 className="font-semibold">Vorschau</h2>
          <ChannelPreviews view={view} />
        </section>

        <aside className="grid content-start gap-4">
          <div className="grid gap-2">
            {p.status === 'zur_freigabe' && (
              <Form method="post">
                <input type="hidden" name="intent" value="approve" />
                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  isDisabled={isAuthor}
                >
                  Freigeben
                </Button>
              </Form>
            )}
            {p.status === 'zur_freigabe' && (
              <Form method="post" className="grid gap-1">
                <input type="hidden" name="intent" value="request_change" />
                <TextArea
                  name="comment"
                  rows={2}
                  placeholder="Was soll sich ändern? (optional)"
                  aria-label="Kommentar"
                  className="w-full"
                />
                <Button type="submit" variant="secondary">
                  Änderung anfragen
                </Button>
              </Form>
            )}
            {p.status === 'aenderung_gewuenscht' && (
              <Form method="post">
                <input type="hidden" name="intent" value="resubmit" />
                <Button type="submit" variant="primary" className="w-full">
                  Erneut zur Freigabe (v{p.version + 1})
                </Button>
              </Form>
            )}
            {['sammeln', 'zur_freigabe', 'aenderung_gewuenscht'].includes(
              p.status,
            ) && (
              <Form method="post" className="grid gap-1">
                <input type="hidden" name="intent" value="ask" />
                <TextArea
                  name="question"
                  rows={2}
                  placeholder="Frage an @… (geht per Matrix-DM)"
                  aria-label="Rückfrage"
                  className="w-full"
                />
                <Button type="submit" variant="outline">
                  Rückfrage ans Mitglied
                </Button>
              </Form>
            )}
            {['sammeln', 'zur_freigabe', 'aenderung_gewuenscht'].includes(
              p.status,
            ) && (
              <Form
                method="post"
                onSubmit={(e) =>
                  !window.confirm('Beitrag wirklich verwerfen?') &&
                  e.preventDefault()
                }
              >
                <input type="hidden" name="intent" value="discard" />
                <Button type="submit" variant="danger" className="w-full">
                  Verwerfen
                </Button>
              </Form>
            )}
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Automatische Checks
            </h2>
            <ul className="grid gap-1 text-sm">
              {view.checks.map((c) => (
                <li
                  key={c.id}
                  className={
                    c.ok
                      ? ''
                      : c.level === 'block'
                        ? 'text-[var(--danger)]'
                        : 'text-[var(--warning)]'
                  }
                >
                  {c.ok ? '✓' : '!'} {c.label}
                </li>
              ))}
              {isAuthor && (
                <li className="text-[var(--danger)]">
                  ! Eigener Beitrag – jemand anderes muss freigeben
                </li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Verlauf
            </h2>
            <ul className="grid gap-1 text-sm">
              {view.history.map((h) => (
                <li key={h.id}>
                  <b>@{h.actor}</b> {h.message} ·{' '}
                  <time dateTime={h.at}>
                    {new Date(h.at).toLocaleString('de-DE', {
                      timeZone: 'Europe/Berlin',
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
