// Reconnect phase (server back up): fresh process with the same durable
// store. The retained sites entry must settle retained -> current; then the
// queue drains in sequence order exactly once, and a second drain is a
// no-op.
import api from '../snapback/generated/api.mjs';
import { env, errorFacts, finish, makeClient, until } from './common.mjs';

const out = { phase: 'reconnect', pid: process.pid, ok: false };
try {
  const client = makeClient({ offlineQueue: true });
  out.rqsStoreInfo = client.rqsStoreInfo;

  const sites = await client.liveQuery(api.listSites, {
    connectionId: 'a1_reconnect_sites',
    transport: 'stream',
    onUpdate: (rows, meta) => {
      out.sitesTransitions = out.sitesTransitions ?? [];
      out.sitesTransitions.push({ kind: meta?.kind ?? null, freshness: meta?.freshness ?? null, rows: rows.length });
    },
  });
  await until(() => sites.connection === 'live', 'sites live again', 10_000);
  out.sites = {
    rows: sites.rows.length,
    freshness: sites.freshness ?? null,
    connection: sites.connection,
  };

  const replay = await client.replayQueuedMutations();
  out.replay = replay;
  const replayAgain = await client.replayQueuedMutations();
  out.replayAgain = replayAgain;
  out.outboxDiagnostics = client.outboxDiagnostics ?? null;

  await sites.dispose();
  await client.closeAuth?.();
  out.ok = replay.replayed === 2 && replay.failed === 0 && replay.remaining === 0
    && replayAgain.replayed === 0 && replayAgain.remaining === 0;
} catch (error) {
  out.error = errorFacts(error);
}
finish(out);
