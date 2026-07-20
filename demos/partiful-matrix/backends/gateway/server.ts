import { createConvexAdapter } from './convex.ts';
import { loadLocalSecrets, requireSecret } from './secrets.mjs';
import { createSnapbackAdapter } from './snapback.ts';
import { createSqliteAdapter } from './sqlite.ts';
import { createSupabaseAdapter } from './supabase.ts';

const local = loadLocalSecrets();
const adapters = {
  snapback: createSnapbackAdapter(),
  sqlite: createSqliteAdapter(),
  supabase: await createSupabaseAdapter(requireSecret(local, 'DIRECT_URL', 'DATABASE_URL', 'SUPABASE_DB_URL')),
  convex: createConvexAdapter(requireSecret(local, 'CONVEX_DEPLOY_KEY', 'CONVEX_URL')),
};

const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

const port = Number(process.env.PARTIFUL_MATRIX_GATEWAY_PORT ?? 4460);
const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, backends: Object.keys(adapters) }, { headers });
    }
    if (request.method !== 'POST' || !['/query', '/mutate'].includes(url.pathname)) {
      return Response.json({ error: 'not found' }, { status: 404, headers });
    }
    try {
      const body = await request.json() as { backend: keyof typeof adapters; name: string; args?: Record<string, unknown>; userId?: string };
      const adapter = adapters[body.backend];
      if (!adapter) throw new Error(`unsupported gateway backend: ${body.backend}`);
      const value = url.pathname === '/query'
        ? await adapter.query(body.name, body.args ?? {})
        : await adapter.mutate(body.name, body.args ?? {}, body.userId ?? 'anonymous');
      return Response.json({ ok: true, value }, { headers });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ ok: false, error: message }, { status: 400, headers });
    }
  },
});

console.log(`[partiful-matrix] gateway ready on http://${server.hostname}:${server.port}`);

const close = async () => {
  server.stop(true);
  await Promise.all(Object.values(adapters).map((adapter) => adapter.close?.()));
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
