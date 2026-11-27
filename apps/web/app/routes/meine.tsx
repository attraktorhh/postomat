import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { Card } from '@heroui/react';
import { requireUser } from '../server/auth.server';
import { botMatrixId, listMine } from '../server/views.server';
import { bannerSrc } from '../urls';
import { Shell } from '../components/shell';
import { Stepper } from '../components/status';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    user: { username: user.username, roles: user.roles },
    posts: await listMine(user.username),
    botLink: `https://matrix.to/#/${await botMatrixId()}`,
  };
}

function note(p: Awaited<ReturnType<typeof loader>>['posts'][number]): string {
  switch (p.status) {
    case 'sammeln':
      return 'Entwurf – schick ihn im Chat mit „abschicken“ ab oder auf der Beitragsseite.';
    case 'zur_freigabe':
    case 'aenderung_gewuenscht':
      return 'Das Medienteam schaut es sich an.';
    case 'geplant':
      return `Freigegeben${p.approvedBy ? ` von @${p.approvedBy}` : ''}. Einige Kanäle folgen noch.`;
    case 'online':
      return `Online: ${p.onlineChannels.join(', ') || '–'}${p.approvedBy ? ` · freigegeben von @${p.approvedBy}` : ''}`;
    case 'verworfen':
      return 'Das Medienteam hat den Beitrag nicht veröffentlicht. Frag gern im Chat nach.';
    default:
      return '';
  }
}

export default function Meine() {
  const { user, posts, botLink } = useLoaderData<typeof loader>();
  return (
    <Shell user={user}>
      <p className="text-sm">
        🔒 Angemeldet als <b>{user.username}</b>
      </p>
      <h1 className="text-xl font-bold">Meine Beiträge</h1>
      <p className="text-sm text-[var(--muted)]">
        Neuen Beitrag startest du im Chat mit{' '}
        <a
          className="underline"
          href={botLink}
          target="_blank"
          rel="noreferrer"
        >
          @postomat
        </a>
        .
      </p>
      {posts.length === 0 && <p className="text-sm">Noch keine Beiträge.</p>}
      {posts.map((p) => (
        <Card key={p.id} className="grid grid-cols-[64px_1fr] gap-3 p-3">
          {p.bannerId ? (
            <img
              src={bannerSrc(p.id, '4x5', p.bannerId)}
              alt=""
              className="h-20 w-16 rounded object-cover"
              loading="lazy"
            />
          ) : (
            <span
              aria-hidden
              className="h-20 w-16 rounded bg-[var(--default)]"
            />
          )}
          <div className="grid min-w-0 gap-1.5">
            <div>
              <Link
                to={`/b/${p.id}`}
                className="font-semibold underline-offset-2 hover:underline"
              >
                {p.title}
              </Link>{' '}
              <span className="text-xs text-[var(--muted)]">{p.sub}</span>
            </div>
            {p.status === 'sammeln' ? (
              <span className="text-xs">Entwurf</span>
            ) : (
              <Stepper stage={p.stage} />
            )}
            <span className="text-xs text-[var(--muted)]">{note(p)}</span>
            {p.links.length > 0 && (
              <span className="flex flex-wrap gap-2 text-xs">
                {p.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    className="underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l.name} ↗
                  </a>
                ))}
              </span>
            )}
          </div>
        </Card>
      ))}
    </Shell>
  );
}
