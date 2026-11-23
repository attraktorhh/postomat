import type { LoaderFunctionArgs } from 'react-router';
import { logout } from '../server/auth.server';

export async function loader({ request }: LoaderFunctionArgs) {
  return logout(request);
}
