import type { LoaderFunctionArgs } from 'react-router';
import { finishLogin } from '../server/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return finishLogin(request);
}
