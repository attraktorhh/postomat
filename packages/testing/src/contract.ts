/**
 * Contract-test target selection. Tests run against in-process fakes by default;
 * with CONTRACT_TARGET=local they run against the docker compose stack using the
 * same env vars as the apps (defaults = local stack).
 */
export const contractTarget = (): 'fake' | 'local' => (process.env['CONTRACT_TARGET'] === 'local' ? 'local' : 'fake');

export const env = (name: string, fallback: string): string => process.env[name]?.trim() || fallback;
