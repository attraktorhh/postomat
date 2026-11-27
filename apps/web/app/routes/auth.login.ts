import type { LoaderFunctionArgs } from 'react-router';
import { startLogin } from '../server/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const returnTo = new URL(request.url).searchParams.get('returnTo') ?? '/';
  return startLogin(request, returnTo);
}
