import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { Alert, Button } from '@heroui/react';
import { getRoomSettings, saveRoomSettings } from '@postomat/workflow';
import { requireUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';
import { formFields, parseForm, roomSettingsSchema } from '../server/forms';
import { botMatrixId, loadRoomDirectory } from '../server/views.server';
import { Shell } from '../components/shell';

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request, ['admin']);
  const deps = await getDeps();
  const dir = await loadRoomDirectory();
  const current = await getRoomSettings(deps);
  const botUser = await botMatrixId();
  // Map aliases from env seeding to room IDs where the directory knows them.
  const norm = (r: string) =>
    dir.rooms.find((x) => x.roomId === r || x.alias === r)?.roomId ?? r;
  return {
    user: { username: user.username, roles: user.roles },
    rooms: dir.rooms,
    updatedAt: dir.updatedAt,
    memberRooms: current.memberRooms.map(norm),
    medienteamRoom: current.medienteamRoom
      ? norm(current.medienteamRoom)
      : null,
    botUser,
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireUser(request, ['admin']);
  const deps = await getDeps();
  const form = await request.formData();
  const parsed = parseForm(roomSettingsSchema, {
    ...formFields(form),
    member: form.getAll('member'),
  });
  if (!parsed.success) return { error: parsed.error };
  await saveRoomSettings(
    deps,
    {
      memberRooms: parsed.data.member,
      medienteamRoom: parsed.data.medienteam,
    },
    user.username,
  );
  return {
    ok: 'Gespeichert. Der Bot übernimmt die Räume innerhalb von 5 Minuten.',
  };
}

export default function Raeume() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === 'submitting';
  return (
    <Shell user={data.user}>
      <h1 className="text-xl font-bold">Räume</h1>
      <p className="text-sm">
        Wer in einem <b>Mitglieder-Raum</b> ist, darf Beiträge einreichen. Wer
        im <b>Medienteam-Raum</b> ist, darf freigeben; dort erscheinen auch die
        Karten.
      </p>
      <details className="rounded-md border border-[var(--border)] p-2 text-sm">
        <summary className="cursor-pointer font-semibold">
          So lädst du den Bot in einen Raum ein
        </summary>
        <ol className="mt-2 list-decimal pl-5">
          <li>Raum in Element öffnen → Personen einladen.</li>
          <li>
            <code>{data.botUser}</code> einladen. Der Bot nimmt Einladungen von
            Mitgliedern automatisch an.
          </li>
          <li>Diese Seite neu laden und den Raum unten auswählen.</li>
        </ol>
      </details>
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
      {data.rooms.length === 0 ? (
        <p className="text-sm">
          Der Bot hat noch keine Räume gemeldet. Läuft er? Er aktualisiert die
          Liste beim Start und alle paar Minuten.
        </p>
      ) : (
        <Form method="post" className="grid gap-2">
          <div className="grid gap-2">
            {data.rooms.map((r) => (
              <div
                key={r.roomId}
                className="grid gap-1 rounded-md border border-[var(--border)] p-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center"
              >
                <span className="min-w-0">
                  <b>{r.name ?? r.alias ?? r.roomId}</b>
                  <span className="block text-xs text-[var(--muted)] [overflow-wrap:anywhere]">
                    {r.alias ?? r.roomId} · {r.memberCount} Mitglieder ·{' '}
                    {r.encrypted ? 'verschlüsselt' : 'unverschlüsselt'}
                  </span>
                </span>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="member"
                    value={r.roomId}
                    defaultChecked={data.memberRooms.includes(r.roomId)}
                  />{' '}
                  Mitglieder
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="medienteam"
                    value={r.roomId}
                    defaultChecked={data.medienteamRoom === r.roomId}
                  />{' '}
                  Medienteam
                </label>
              </div>
            ))}
          </div>
          <div>
            <Button type="submit" variant="primary" isPending={saving}>
              Speichern
            </Button>
          </div>
          {data.updatedAt && (
            <span className="text-xs text-[var(--muted)]">
              Raumliste vom Bot:{' '}
              {new Date(data.updatedAt).toLocaleString('de-DE', {
                timeZone: 'Europe/Berlin',
              })}
            </span>
          )}
        </Form>
      )}
    </Shell>
  );
}
