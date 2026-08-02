import { mustGetMutator, mustGetQuery } from '@rocicorp/zero';
import { handleMutateRequest, handleQueryRequest } from '@rocicorp/zero/server';
import { zeroPostgresJS } from '@rocicorp/zero/server/adapters/postgresjs';
import postgres from 'postgres';
import { mutators } from './mutators.ts';
import { queries } from './queries.ts';
import { schema, type Context } from './schema.ts';

export function startApi(databaseURL: string, latencyMs = 1000) {
  const sql = postgres(databaseURL, { max: 10 });
  const dbProvider = zeroPostgresJS(schema, sql);
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const ctx: Context = { userID: request.headers.get('x-bakeoff-user') ?? 'anonymous' };
      if (request.method === 'POST' && url.pathname === '/query') {
        const result = await handleQueryRequest({
          handler: (name, args) => mustGetQuery(queries, name).fn({ args, ctx }),
          schema, request, userID: ctx.userID,
        });
        return Response.json(result);
      }
      if (request.method === 'POST' && url.pathname === '/mutate') {
        await Bun.sleep(latencyMs);
        const result = await handleMutateRequest({
          dbProvider,
          handler: (transact) => transact((tx, name, args) =>
            mustGetMutator(mutators, name).fn({ tx, args, ctx })),
          request, userID: ctx.userID,
        });
        return Response.json(result);
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    async close() { server.stop(true); await sql.end({ timeout: 2 }); },
  };
}
