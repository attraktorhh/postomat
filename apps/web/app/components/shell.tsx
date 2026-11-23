import { NavLink } from 'react-router';
import type { Role } from '../server/roles';

export interface ShellUser {
  username: string;
  roles: Role[];
}

/** Page frame: top bar with role-based navigation. Works down to 360px. */
export function Shell({ user, children, wide = false }: { user: ShellUser; children: React.ReactNode; wide?: boolean }) {
  const nav = [
    { to: '/meine', label: 'Meine Beiträge', show: true },
    { to: '/redaktion', label: 'Redaktion', show: user.roles.includes('medienteam') },
    { to: '/admin/raeume', label: 'Räume', show: user.roles.includes('admin') },
  ].filter((n) => n.show);
  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className={`mx-auto flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <a href="/" className="font-bold">
            Postomat
          </a>
          <nav className="flex flex-wrap gap-3 text-sm">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'font-semibold underline' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <span className="ml-auto text-xs text-[var(--muted)]">
            @{user.username} ·{' '}
            <a className="underline" href="/auth/logout">
              Abmelden
            </a>
          </span>
        </div>
      </header>
      <main className={`mx-auto grid gap-4 px-4 py-4 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>
    </div>
  );
}

export function LoginNote({ username }: { username: string }) {
  return (
    <p className="rounded-md bg-[var(--surface-secondary,var(--surface))] px-3 py-2 text-sm">
      🔒 Angemeldet über Attraktor-Login (Keycloak) als <b>{username}</b>
    </p>
  );
}
