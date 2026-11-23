import { createServer, type Server } from 'node:http';

/** Tiny health server: GET /healthz → 200 {"ok":true} when `check` passes. */
export function startHealthServer(port: number, check: () => Promise<boolean | Record<string, unknown>>): Server {
  const server = createServer(async (req, res) => {
    if (req.url !== '/healthz') {
      res.writeHead(404).end();
      return;
    }
    try {
      const r = await check();
      const ok = r === true || (typeof r === 'object' && r !== null);
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok, ...(typeof r === 'object' ? r : {}) }));
    } catch (e) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
  });
  server.listen(port);
  return server;
}
