import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { Alert, Button, TextArea } from '@heroui/react';
import { conversations, eq } from '@postomat/db';
import { DM } from '@postomat/templates';
import { submitPost } from '@postomat/workflow';
import { requirePostAccess } from '../server/access.server';
import { actionError } from '../server/errors';
import { getDeps } from '../server/deps.server';
import { formFields, parseForm, submitSchema } from '../server/forms';
import { loadPostView } from '../server/views.server';
import { LoginNote, Shell } from '../components/shell';
import { StageTape, StatusTape, Stepper } from '../components/status';
import { ChannelPreviews } from '../components/previews';

const SUBMITTED_NOTE =
  'Ist beim Medienteam 🙌 Wir melden uns im Chat, sobald es online ist.';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, post, isAuthor } = await requirePostAccess(
    request,
    params['id'],
  );
  const isTeam = user.roles.includes('medienteam');
  // Members get a reduced view without internal Medienteam data.
  const view = await loadPostView(post.id, { forMember: !isTeam });
  const submitted = new URL(request.url).searchParams.has('abgeschickt');
  return {
    user: { username: user.username, roles: user.roles },
    view,
    isAuthor,
    isTeam,
    submitted,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, post, isAuthor } = await requirePostAccess(
    request,
    params['id'],
  );
  const id = post.id;
  const deps = await getDeps();
  if (!isAuthor)
    return {
      error: 'Nur die Autorin oder der Autor kann den Beitrag abschicken.',
    };
  if (post.status !== 'sammeln') return { error: DM.alreadySubmitted };
  const parsed = parseForm(submitSchema, formFields(await request.formData()));
  if (!parsed.success) return { error: parsed.error };
  try {
    await submitPost(deps, id, user.username, parsed.data.note);
  } catch (e) {
    return { error: actionError(e) };
  }
  // Also reset the DM conversation and confirm there.
  await deps.db
    .update(conversations)
    .set({ state: null, postId: null })
    .where(eq(conversations.postId, id));
  await deps.queue.send('bot.dm', {
    matrixUserId: post.authorMatrixId,
    text: DM.submitted,
  });
  return redirect(`/b/${id}?abgeschickt=1`);
}

export default function Beitrag() {
  const { user, view, isAuthor, isTeam, submitted } =
    useLoaderData<typeof loader>();
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
        {isTeam ? (
          <StatusTape status={p.status} version={p.version} />
        ) : (
          <StageTape stage={p.stage} />
        )}
      </div>
      {p.status !== 'sammeln' && <Stepper stage={p.stage} />}
      {submitted && p.status !== 'sammeln' && (
        <Alert status="success">
          <Alert.Content>
            <Alert.Description>{SUBMITTED_NOTE}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <ChannelPreviews view={view} />
      {p.status === 'sammeln' && isAuthor ? (
        <Form
          method="post"
          className="grid gap-2 rounded-lg border border-[var(--accent)] p-3"
        >
          <label htmlFor="note" className="text-sm">
            <b>Notiz fürs Medienteam</b>{' '}
            <span className="text-[var(--muted)]">(optional)</span>
          </label>
          <TextArea
            id="note"
            name="note"
            rows={3}
            defaultValue={p.note ?? ''}
            className="w-full"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              isPending={nav.state === 'submitting'}
            >
              Ans Medienteam schicken
            </Button>
            <span className="text-xs text-[var(--muted)]">
              Texte ändern kann das Medienteam. Fehlt etwas Inhaltliches,
              schreib es einfach in die Notiz.
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
        p.note && (
          <p className="rounded-md bg-[var(--default)] p-2 text-sm">
            Notiz: „{p.note}“
          </p>
        )
      )}
    </Shell>
  );
}
