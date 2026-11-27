import {
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { logout } from '../server/auth.server';

/** Logout is a POST (form button), so other sites cannot log users out. */
export async function action({ request }: ActionFunctionArgs) {
  return logout(request);
}

export async function loader(_args: LoaderFunctionArgs) {
  return redirect('/');
}
