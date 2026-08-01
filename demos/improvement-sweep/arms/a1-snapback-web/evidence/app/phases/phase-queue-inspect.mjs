// Restart-while-offline inspection: a fresh process reads the durable
// outbox directly from the arm-owned store directory (same on-disk contract
// the default resolution uses) and proves the queued intents survived the
// restart. Also probes the LLP 0090 D3 outbox rule: with pending intent, a
// relaunch renders nothing ahead of the full resync — even the previously
// retained public sites rows.
import { createFileRqsResumeStore } from '@expo/snapback-client/rqs-store-file';
import api from '../snapback/generated/api.mjs';
import { env, errorFacts, finish, makeClient, sleep } from './common.mjs';

const out = { phase: 'queue-inspect', pid: process.pid, ok: false };
try {
  const url = new URL(env('A1_SERVER_URL'));
  const store = createFileRqsResumeStore({
    directory: env('SNAPBACK_CLIENT_RQS_DIR'),
    identity: `origin:${url.protocol}//${url.host}`,
  });
  const records = await store.outboxRecords();
  out.outbox = records.map((entry) => ({
    sequence: entry.sequence ?? null,
    function: entry.function ?? entry.functionName ?? null,
    clientMutationId: entry.clientMutationId ?? null,
    state: entry.state ?? entry.status ?? null,
  }));

  // D3 probe: cold relaunch with non-empty outbox. The documented LLP 0090
  // rule is "renders nothing ahead of the full resync" — observed either as
  // an empty/unretained handle or as the original connectivity error.
  const client = makeClient();
  try {
    const sites = await client.liveQuery(api.listSites, {
      connectionId: 'a1_d3_sites',
      transport: 'stream',
    });
    await sleep(1_500);
    out.d3Probe = {
      resolved: true,
      rows: sites.rows.length,
      freshness: sites.freshness ?? null,
      connection: sites.connection,
    };
    await sites.dispose();
  } catch (error) {
    out.d3Probe = { resolved: false, error: errorFacts(error) };
  }
  await client.closeAuth?.();

  out.ok = out.outbox.length === 2;
} catch (error) {
  out.error = errorFacts(error);
}
finish(out);
