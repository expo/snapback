// Warm phase (online): the "previously opened client". Subscribes the
// public sites live query (rqsEligible — persists) and the protected
// records live query (auth-scoped — must refuse retention with the exact
// documented fact), then closes like a browser tab.
import api from '../snapback/generated/api.mjs';
import { env, errorFacts, finish, makeClient, sleep, until } from './common.mjs';

const out = { phase: 'warm', pid: process.pid, ok: false };
try {
  const client = makeClient();
  out.rqsStoreInfo = client.rqsStoreInfo;

  const sites = await client.liveQuery(api.listSites, {
    connectionId: 'a1_warm_sites',
    transport: 'stream',
  });
  await until(() => sites.connection === 'live', 'sites live');
  out.sites = {
    rows: sites.rows.length,
    version: sites.version,
    freshness: sites.freshness ?? null,
    connection: sites.connection,
    retention: sites.retention ?? null,
  };

  const records = await client.liveQuery(api.listRecords, {
    args: { workspaceId: env('A1_WORKSPACE') },
    connectionId: 'a1_warm_records',
    transport: 'stream',
  });
  await until(() => records.connection === 'live', 'records live');
  out.records = {
    rows: records.rows.length,
    version: records.version,
    freshness: records.freshness ?? null,
    retention: records.retention ?? null,
  };

  // Let the persistence cadence settle before closing the "tab".
  await sleep(1200);
  await records.dispose();
  await sites.dispose();
  await client.closeAuth?.();
  out.ok = true;
} catch (error) {
  out.error = errorFacts(error);
}
finish(out);
