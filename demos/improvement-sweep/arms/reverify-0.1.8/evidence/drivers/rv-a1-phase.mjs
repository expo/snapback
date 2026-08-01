// Phase child for the 0.1.8 A1/Expo re-verification. Phase via argv[2].
import { writeFileSync } from 'node:fs';
import { SnapbackClient, createExternalSessionClient } from '@expo/snapback-client';

const phase = process.argv[2];
const out = { phase, pid: process.pid, ok: false };
const env = (n) => { const v = process.env[n]; if (!v) throw new Error(`missing ${n}`); return v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { const v = await fn(); if (v) return v;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`); await sleep(30); }
};
const errorFacts = (e) => ({ message: String(e?.message ?? e), code: e?.diagnostic?.code ?? e?.code ?? null, name: e?.name ?? null });
const makeClient = (extra = {}) => new SnapbackClient(env('A1_SERVER_URL'), {
  bearerToken: env('A1_BEARER'), authClientProtocol: 1, authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1, authorizedLeaseProtocol: 1,
  clientStoreId: env('A1_STORE_ID'), ...extra,
});

// RV-A1E-F1 needs a cryptoless runtime BEFORE the client module loads its
// crypto seams; strip it at phase start (import above is fine — the seam is
// exercised at client construction/binding time).
if (phase === 'cryptoless') {
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
}

const api = (await import('./snapback/generated/api.mjs')).default;

try {
  if (phase === 'warm') {
    const client = makeClient();
    out.rqsStoreInfo = client.rqsStoreInfo;
    const sites = await client.liveQuery(api.listSites, { connectionId: 'rv_warm_sites', transport: 'stream' });
    await until(() => sites.connection === 'live', 'sites live');
    out.sites = { rows: sites.rows.length, freshness: sites.freshness ?? null, retention: sites.retention ?? null };
    await sleep(1300);
    await sites.dispose();
    await client.closeAuth?.();
    out.ok = out.sites.rows > 0;
  } else if (phase === 'cold-retained') {
    // RV-A1-F4: guide-declared rqsEligible query cold-boots retained offline.
    const client = makeClient();
    out.rqsStoreInfo = client.rqsStoreInfo;
    const sites = await client.liveQuery(api.listSites, { connectionId: 'rv_cold_sites', transport: 'stream' });
    await until(() => sites.freshness === 'retained' && sites.connection === 'stale', 'retained boot', 6_000);
    out.sites = { rows: sites.rows.length, freshness: sites.freshness, connection: sites.connection };
    await sites.dispose();
    await client.closeAuth?.();
    out.ok = out.sites.rows > 0;
  } else if (phase === 'queue-plain-error') {
    // RV-A1E-F2: connectivity classified by provenance — a PLAIN Error fetch
    // rejection (the RN/Expo shape) must queue, not surface raw.
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('Could not connect to the server. (simulated RN carrier)'));
    const client = makeClient({ offlineQueue: true });
    const queued = await client.mutate(api.updateRecord, {
      args: { recordId: env('A1_RECORD'), notes: 'rv018 queued via plain-Error rejection' },
    });
    globalThis.fetch = realFetch;
    out.queued = queued;
    out.ok = queued?.queued === true && typeof queued?.clientMutationId === 'string';
  } else if (phase === 'relaunch-pending') {
    // RV-A1-F6: cold relaunch, still offline, pending intent in the store —
    // fixed behavior renders retained rows PLUS an explicit pending fact.
    const client = makeClient({ offlineQueue: true });
    out.rqsStoreInfo = client.rqsStoreInfo;
    const sites = await client.liveQuery(api.listSites, { connectionId: 'rv_d3_sites', transport: 'stream' });
    await until(() => (sites.rows?.length ?? 0) > 0 || sites.freshness === 'retained', 'retained rows with pending intent', 6_000)
      .catch(() => {});
    await sleep(800);
    out.sites = { rows: sites.rows?.length ?? 0, freshness: sites.freshness ?? null, connection: sites.connection ?? null, retention: sites.retention ?? null };
    out.outboxDiagnostics = client.outboxDiagnostics ?? null;
    // RV-A1-F5 (headless half): the react-package projection over this state.
    try {
      const { createSnapbackReactProvider, observeSnapbackQueries, observeSnapbackOutbox } = await import('@expo/snapback-react');
      const schema = (await import('./snapback/generated/schema.manifest.json', { with: { type: 'json' } })).default;
      const functions = (await import('./snapback/generated/functions.manifest.json', { with: { type: 'json' } })).default;
      const capabilityManifest = (await import('./snapback/generated/capability.manifest.json', { with: { type: 'json' } })).default;
      const rclient = createExternalSessionClient(env('A1_SERVER_URL'), {
        bearerToken: env('A1_BEARER'), clientStoreId: env('A1_STORE_ID'), offlineQueue: true,
      });
      const binding = await rclient.prepareReactBinding({ generatedManifest: { schema, functions, capabilityManifest } });
      const provider = createSnapbackReactProvider(binding);
      let snap = null;
      const qObs = observeSnapbackQueries(provider, { sites: { ref: api.listSites, args: {} } }, (s) => { snap = s; });
      let outbox = null;
      const oObs = observeSnapbackOutbox(provider, (s) => { outbox = s; });
      await until(() => snap?.queries?.sites && snap.queries.sites.freshness === 'retained', 'react retained freshness', 8_000).catch(() => {});
      out.react = {
        freshness: snap?.queries?.sites?.freshness ?? null,
        rows: snap?.queries?.sites?.data?.length ?? null,
        retention: snap?.queries?.sites?.retention ?? null,
        outbox,
      };
      qObs.dispose(); oObs.dispose(); await provider.dispose();
    } catch (error) {
      out.react = { error: errorFacts(error) };
    }
    await sites.dispose();
    await client.closeAuth?.();
    out.ok = out.sites.rows > 0 && out.sites.freshness === 'retained';
  } else if (phase === 'reconnect') {
    const client = makeClient({ offlineQueue: true });
    const replay = await client.replayQueuedMutations();
    const again = await client.replayQueuedMutations();
    out.replay = replay; out.replayAgain = again;
    await client.closeAuth?.();
    out.ok = replay.replayed >= 1 && replay.failed === 0 && replay.remaining === 0 && again.replayed === 0;
  } else if (phase === 'cryptoless') {
    // RV-A1E-F1: no globalThis.crypto — client boots to a live query with
    // zero consumer polyfills.
    out.cryptoAbsent = globalThis.crypto === undefined;
    const client = makeClient();
    const sites = await client.liveQuery(api.listSites, { connectionId: 'rv_nocrypto', transport: 'stream' });
    await until(() => sites.connection === 'live', 'live without crypto');
    out.sites = { rows: sites.rows.length, connection: sites.connection };
    await sites.dispose();
    await client.closeAuth?.();
    out.ok = out.cryptoAbsent && out.sites.rows >= 0 && out.sites.connection === 'live';
  } else if (phase === 'rotation') {
    // RV-A1E-F4: downgrade rotation settles; denial is a handle fact; back-
    // rotation restores rows.
    const client = makeClient();
    const records = await client.liveQuery(api.listRecords, {
      args: { workspaceId: env('A1_WORKSPACE') }, connectionId: 'rv_rot', transport: 'stream',
    });
    await until(() => records.connection === 'live', 'records live');
    out.beforeRows = records.rows.length;
    let transitionError = null;
    try { await client.replaceBearerToken(env('A1_MALLORY_BEARER')); }
    catch (error) { transitionError = errorFacts(error); }
    out.downgrade = { threw: transitionError !== null, error: transitionError };
    await sleep(1200);
    out.duringDenial = {
      rows: records.rows.length,
      denial: records.denial ?? records.authority ?? records.error ?? records.diagnostic ?? null,
      connection: records.connection,
    };
    let backError = null;
    try { await client.replaceBearerToken(env('A1_BEARER')); }
    catch (error) { backError = errorFacts(error); }
    await until(() => records.rows.length === out.beforeRows, 'rows restored after back-rotation', 10_000).catch(() => {});
    out.back = { threw: backError !== null, error: backError, rows: records.rows.length };
    await records.dispose();
    await client.closeAuth?.();
    out.ok = out.downgrade.threw === false && out.duringDenial.rows === 0
      && out.back.threw === false && out.back.rows === out.beforeRows;
  } else {
    throw new Error(`unknown phase ${phase}`);
  }
} catch (error) {
  out.error = errorFacts(error);
}
writeFileSync(env('A1_OUT'), JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
