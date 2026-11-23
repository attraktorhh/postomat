import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { requireUser } from '../server/auth.server';
import { loadQueue } from '../server/views.server';
import { Shell } from '../components/shell';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request, ['medienteam']);
  return { user: { username: user.username, roles: user.roles }, groups: await loadQueue() };
}

export default function Redaktion() {
  const { user, groups } = useLoaderData<typeof loader>();
  return (
    <Shell user={user} wide>
      <h1 className="text-xl font-bold">Redaktion</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <section key={g.label} className="grid content-start gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {g.label} · {g.items.length}
              {g.label === 'Online' ? ' (letzte 30 Tage)' : ''}
            </h2>
            {g.items.length === 0 && <p className="text-sm text-[var(--muted)]">–</p>}
            {g.items.map((i) => (
              <Link key={i.id} to={`/redaktion/${i.id}`} className="grid rounded-md border border-[var(--border)] p-2 hover:bg-[var(--default)]">
                <span className="font-semibold">
                  {i.title}
                  {i.version > 1 ? <span className="ml-1 text-xs text-[var(--muted)]">v{i.version}</span> : null}
                </span>
                <span className="text-xs text-[var(--muted)]">{i.meta}</span>
              </Link>
            ))}
          </section>
        ))}
      </div>
    </Shell>
  );
}
