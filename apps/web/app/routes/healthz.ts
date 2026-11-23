import { getDbHandle } from '../server/deps.server';

export async function loader() {
  try {
    const db = await getDbHandle();
    await db.pool.query('select 1');
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 503 });
  }
}
