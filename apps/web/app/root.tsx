import {
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  type MetaFunction,
} from 'react-router';
import { LogoutButton } from './components/shell';
import stylesHref from '../styles.css?url';

export const meta: MetaFunction = () => [{ title: 'Postomat' }];
export const links = () => [{ rel: 'stylesheet', href: stylesHref }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const forbidden = isRouteErrorResponse(error) && error.status === 403;
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // A 403 with a specific reason ("nur fürs Medienteam", "nicht dein
  // Beitrag") shows that reason; the plain one means "no Postomat group".
  const reason =
    forbidden && typeof error.data === 'string' && error.data !== 'Kein Zugang'
      ? error.data
      : null;
  return (
    <main className="mx-auto grid max-w-xl gap-3 p-4">
      <h1 className="text-xl font-bold">
        {forbidden ? 'Kein Zugang' : notFound ? 'Nicht gefunden' : 'Fehler'}
      </h1>
      <p className="text-sm">
        {reason
          ? reason
          : forbidden
            ? 'Dein Attraktor-Login gehört zu keiner Postomat-Gruppe (mitglieder, medienteam, postomat-admin). Frag das Medienteam, wenn das nicht stimmt.'
            : isRouteErrorResponse(error)
              ? String(error.data)
              : 'Da ist etwas schiefgegangen.'}
      </p>
      <p className="flex gap-3 text-sm">
        <Link className="underline" to="/">
          Zur Startseite
        </Link>
        <LogoutButton />
      </p>
    </main>
  );
}
