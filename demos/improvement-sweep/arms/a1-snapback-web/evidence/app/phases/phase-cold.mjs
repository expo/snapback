// Cold-restart phase: fresh process, backend unreachable. The rqsEligible
// sites query must boot from the verified persisted entry (freshness
// 'retained', connection 'stale'); the protected records query must fail
// with the connectivity error, having never persisted.
import api from '../snapback/generated/api.mjs';
import { env, errorFacts, finish, makeClient, until } from './common.mjs';

const out = { phase: 'cold', pid: process.pid, ok: false };
try {
  // Transport-disabled proof: the origin refuses connections.
  try {
    await fetch(`${env('A1_SERVER_URL')}/health`);
    out.transport = { disabled: false };
  } catch (error) {
    out.transport = { disabled: true, error: errorFacts(error) };
  }

  const client = makeClient();
  out.rqsStoreInfo = client.rqsStoreInfo;

  const sites = await client.liveQuery(api.listSites, {
    connectionId: 'a1_cold_sites',
    transport: 'stream',
  });
  await until(
    () => sites.freshness === 'retained' && sites.connection === 'stale',
    'retained offline boot',
    5_000,
  );
  out.sites = {
    rows: sites.rows.map((row) => ({ _id: row._id, name: row.name })),
    version: sites.version,
    freshness: sites.freshness ?? null,
    connection: sites.connection,
    retention: sites.retention ?? null,
  };

  let recordsOutcome = null;
  try {
    const records = await client.liveQuery(api.listRecords, {
      args: { workspaceId: env('A1_WORKSPACE') },
      connectionId: 'a1_cold_records',
      transport: 'stream',
    });
    recordsOutcome = {
      resolved: true,
      rows: records.rows.length,
      freshness: records.freshness ?? null,
      retention: records.retention ?? null,
    };
    await records.dispose();
  } catch (error) {
    recordsOutcome = { resolved: false, error: errorFacts(error) };
  }
  out.protectedRecords = recordsOutcome;

  await sites.dispose();
  await client.closeAuth?.();
  out.ok = out.transport.disabled === true
    && out.sites.freshness === 'retained'
    && out.sites.connection === 'stale'
    && out.sites.rows.length > 0;
} catch (error) {
  out.error = errorFacts(error);
}
finish(out);
