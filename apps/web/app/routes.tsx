import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./routes/home.tsx'),
  route('healthz', './routes/healthz.ts'),
  route('auth/login', './routes/auth.login.ts'),
  route('auth/callback', './routes/auth.callback.ts'),
  route('auth/logout', './routes/auth.logout.ts'),
  route('banner/:id/:format', './routes/banner.ts'),
  route('foto/:id', './routes/foto.ts'),
  route('b/:id', './routes/beitrag.tsx'),
  route('meine', './routes/meine.tsx'),
  route('redaktion', './routes/redaktion.tsx'),
  route('redaktion/:id', './routes/redaktion.post.tsx'),
  route('redaktion/:id/:channel', './routes/redaktion.copy.tsx'),
  route('admin/raeume', './routes/admin.raeume.tsx'),
] satisfies RouteConfig;
