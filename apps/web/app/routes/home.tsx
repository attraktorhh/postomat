import { redirect, type LoaderFunctionArgs } from 'react-router';
import { Button } from '@heroui/react';
import { getUser } from '../server/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  if (!user) return null;
  if (!user.roles.length) throw new Response('Kein Zugang', { status: 403 });
  return redirect(user.roles.includes('medienteam') ? '/redaktion' : '/meine');
}

export default function Home() {
  return (
    <main className="mx-auto grid max-w-md gap-4 p-6">
      <h1 className="text-2xl font-bold">Postomat</h1>
      <p className="text-sm">
        Beiträge für den Attraktor: Erzähl dem Bot <b>@postomat</b> in Matrix,
        was du vorhast. Hier siehst du deine Beiträge und das Medienteam
        bearbeitet sie.
      </p>
      <form action="/auth/login" method="get">
        <Button type="submit" variant="primary">
          Mit Attraktor-Login anmelden
        </Button>
      </form>
    </main>
  );
}
