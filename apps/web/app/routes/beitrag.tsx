import { Form, redirect, useActionData, useLoaderData, useNavigation, type ActionFunctionArgs, type LoaderFunctionArgs } from 'react-router';
import { Alert, Button, TextArea } from '@heroui/react';
import { DM } from '@postomat/templates';
import { getPost, submitPost } from '@postomat/workflow';
import { requireUser, type CurrentUser } from '../server/auth.server';
import { getDeps } from '../server/deps.server';
import { loadPostView } from '../server/views.server';
import { LoginNote, Shell } from '../components/shell';
import { StatusTape, Stepper } from '../components/status';
import { ChannelPreviews } from '../components/previews';

async function access(request: Request, id: number): Promise<CurrentUser> {
  const user = await requireUser(request);
  const deps = await getDeps();
  const post = await getPost(deps.db, id).catch(() => {
    throw new Response('Beitrag nicht gefunden', { status: 404 });
  });
  if (post.authorUsername !== user.username && !user.roles.includes('medienteam')) throw new Response('Kein Zugang', { status: 403 });
  return user;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const id = Number(params['id']);
  const user = await access(request, id);
  const view = await loadPostView(id);
  return { user: { username: user.username, roles: user.roles }, view, isAuthor: view.post.authorUsername === user.username };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const id = Number(params['id']);
  const user = await access(request, id);
  const deps = await getDeps();
  const post = await getPost(deps.db, id);
  if (post.authorUsername !== user.username) return { error: 'Nur die Autorin oder der Autor kann den Beitrag abschicken.' };
  if (post.status !== 'sammeln') return { error: DM.alreadySubmitted };
  const form = await request.formData();
  const note = String(form.get('note') ?? '').slice(0, 2000);
  try {
    await submitPost(deps, id, user.username, note);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // Also reset the DM conversation and confirm there.
  const { conversations, eq } = await import('@postomat/db');
  await deps.db.update(conversations).set({ state: null, postId: null }).where(eq(conversations.postId, id));
  await deps.queue.send('bot.dm', { matrixUserId: post.authorMatrixId, text: DM.submitted });
  return redirect(`/b/${id}?abgeschickt=1`);
}

export default function Beitrag() {
  const { user, view, isAuthor } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const p = view.post;
  return (
    <Shell user={user}>
      <LoginNote username={user.username} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{p.title}</h1>
          <span className="text-sm text-[var(--muted)]">{p.factsLine}</span>
        </div>
        <StatusTape status={p.status} version={p.version} />
      </div>
      {p.status !== 'sammeln' && <Stepper done={p.stage.done} discarded={p.stage.discarded} />}
      <ChannelPreviews view={view} />
      {p.status === 'sammeln' && isAuthor ? (
        <Form method="post" className="grid gap-2 rounded-lg border border-[var(--accent)] p-3">
          <label htmlFor="note" className="text-sm">
            <b>Notiz fürs Medienteam</b> <span className="text-[var(--muted)]">(optional)</span>
          </label>
          <TextArea id="note" name="note" rows={3} defaultValue={p.note ?? ''} className="w-full" />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" isPending={nav.state === 'submitting'}>
              Ans Medienteam schicken
            </Button>
            <span className="text-xs text-[var(--muted)]">
              Texte ändern kann das Medienteam. Fehlt etwas Inhaltliches, schreib es einfach in die Notiz.
            </span>
          </div>
          {result?.error && (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{result.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </Form>
      ) : (
        p.note && <p className="rounded-md bg-[var(--default)] p-2 text-sm">Notiz: „{p.note}“</p>
      )}
    </Shell>
  );
}
