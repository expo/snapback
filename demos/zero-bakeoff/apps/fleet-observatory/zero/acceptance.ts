import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {assert, assertEqual, createArmSuite, eventually, loadAcceptance} from '../../../shared/harness.mjs';
import {telemetryBurst} from '../fixture.mjs';
import {mutators} from './mutators.ts';
import {queries} from './queries.ts';
import {startFleetZeroRuntime} from './runtime.ts';

// @ref LLP 0138#the-six-application-contracts — A6 measures bounded custody,
// filter churn, live burst convergence, active views, and restart behavior.
const manifest = await loadAcceptance('fleet-observatory');
const suite = createArmSuite({app: 'fleet-observatory', provider: 'zero', manifest, evidencePath: resolve(import.meta.dirname, '..', 'evidence', 'zero.v1.json')});

function waitComplete(view: any, timeoutMs = 60_000) {
  return new Promise<{firstUsefulMs: number | null; completeMs: number}>((resolveDone, reject) => {
    const started = performance.now(); let firstUsefulMs: number | null = null;
    const timer = setTimeout(() => reject(Object.assign(new Error('query completeness timeout'), {code: 'ZERO_QUERY_COMPLETE_TIMEOUT'})), timeoutMs);
    let remove = () => {};
    remove = view.addListener((data: readonly unknown[], type: string) => {
      if (firstUsefulMs === null && data.length > 0) firstUsefulMs = performance.now() - started;
      if (type === 'complete') { clearTimeout(timer); remove(); resolveDone({firstUsefulMs, completeMs: performance.now() - started}); }
    });
  });
}

let runtime: Awaited<ReturnType<typeof startFleetZeroRuntime>> | undefined;
try {
  runtime = await startFleetZeroRuntime(); suite.cleanup(() => runtime!.close());
  const alice = runtime.client('alice'); const bob = runtime.client('bob'); const bobWriter = runtime.client('bob'); const mallory = runtime.client('mallory');

  await suite.pass('fo.initial-bounded-slice', async () => {
    const rows: any[] = await alice.run(queries.events.latest({fleetID: 'fleet-0', severity: 'critical'}), {type: 'complete'});
    assertEqual(rows.length, 100, 'initial route must contain exactly 100 events');
    assert(rows.every((row) => row.fleetID === 'fleet-0' && row.severity === 'critical' && row.device?.id && row.owner?.id), 'bounded route omitted a relation or admitted a nonmatch');
    return {rows: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows))};
  });

  await suite.pass('fo.first-useful-vs-complete', async () => {
    const cold = runtime!.client('alice');
    const view = cold.materialize(queries.events.latest({fleetID: 'fleet-0', severity: 'critical', region: 'iad'}));
    const timing = await waitComplete(view); view.destroy();
    assert(timing.firstUsefulMs !== null && timing.completeMs >= timing.firstUsefulMs, 'first useful and completeness axes were not independently observed');
    return timing;
  });

  await suite.pass('fo.filter-churn-custody', async () => {
    const samples = [];
    for (let index = 0; index < 20; index += 1) {
      const filters = {fleetID: 'fleet-0', severity: 'critical', region: ['iad', 'sfo', 'fra', 'sin', 'syd'][index % 5], deviceStatus: ['healthy', 'degraded', 'offline'][index % 3]};
      const started = performance.now();
      const rows: any[] = await alice.run(queries.events.latest(filters), {type: 'complete'});
      samples.push(performance.now() - started);
      assert(rows.every((row) => row.region === filters.region && row.deviceStatus === filters.deviceStatus), `predecessor rows leaked into filter ${index}`);
    }
    return {switches: 20, samplesMs: samples};
  });

  const observer = bob.materialize(queries.events.latest({fleetID: 'fleet-0', severity: 'critical'}));
  suite.cleanup(() => observer.destroy()); await waitComplete(observer);

  await suite.pass('fo.matching-update-convergence', async () => {
    const updates = telemetryBurst().map((row) => ({eventID: row.eventKey, message: row.message}));
    const settlement = bobWriter.mutate(mutators.telemetry.applyBurst({updates}));
    const clientAt = performance.now(); await settlement.client;
    const serverAt = performance.now(); assertEqual((await settlement.server).type, 'success', 'burst did not settle authoritatively');
    await eventually(() => (observer.data as any[]).filter((row) => row.message.startsWith('Burst-updated')).length === 100, {timeoutMs: 30_000, label: '100 matching Zero updates'});
    return {updates: 1_000, activeMatches: 100, clientSettlementAt: clientAt, serverSettlementAt: serverAt};
  });

  await suite.pass('fo.no-full-dataset-transfer', async () => {
    const localEvents = await bob.inspector.client.rows('fo_event');
    assert(localEvents.length < 10_000, `client retained ${localEvents.length} event rows from a 250,000-event fixture`);
    return {fixtureEvents: 250_000, clientEventRows: localEvents.length, currentResultRows: (observer.data as any[]).length};
  });

  await suite.pass('fo.active-view-resources', async () => {
    const client = runtime!.client('bob'); const views: any[] = []; const hydrationMs: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const view = client.materialize(queries.events.latest({fleetID: `fleet-${index % 5}`, severity: 'critical', region: ['iad', 'sfo', 'fra', 'sin', 'syd'][index % 5]}));
      views.push(view); const timing = await waitComplete(view); hydrationMs.push(timing.completeMs);
    }
    const rows = await client.inspector.client.rows('fo_event');
    const queriesActive = await client.inspector.client.queries();
    const resources = {views: views.length, clientEventRows: rows.length, inspectorQueries: queriesActive.length, processRssBytes: process.memoryUsage().rss, hydrationMs};
    for (const view of views) view.destroy();
    assertEqual(resources.views, 20, 'twenty views were not active');
    return resources;
  });

  await suite.gap('fo.warm-cold-restart', 'Headless Node/Bun acceptance uses Zero kvStore=mem; browser IndexedDB warm/cold restart requires the browser carrier', {code: 'ZERO_BAKEOFF_BROWSER_INDEXEDDB_REQUIRED'});

  await suite.pass('fo.outsider-nonreplication', async () => {
    const rows = await mallory.run(queries.events.latest({fleetID: 'fleet-0', severity: 'critical'}), {type: 'complete'});
    const localRows = await mallory.inspector.client.rows('fo_event');
    assertEqual(rows.length, 0, 'Mallory received a protected query row');
    assertEqual(localRows.length, 0, 'Mallory replicated protected event bytes');
    return {queryRows: rows.length, clientEventRows: localRows.length};
  });
} catch (error: any) {
  for (const id of manifest.checks) {
    try { await suite.gap(id, 'Zero full-scale runtime was unavailable before the check could execute', {code: error?.code ?? 'ZERO_RUNTIME_UNAVAILABLE', message: String(error?.message ?? error)}); }
    catch (duplicate: any) { if (!String(duplicate?.message ?? duplicate).includes('ZERO_BAKEOFF_DUPLICATE_CHECK')) throw duplicate; }
  }
}

const receipt = await suite.finish({
  target: {providerVersion: '1.8.0', storage: 'PostgreSQL 17 + zero-cache-dev', clientStore: 'memory (headless acceptance)'}, fixture: manifest.fixture,
  nonclaims: ['No Cloud Zero claim', 'Browser IndexedDB restart is a retained GAP', 'Process RSS includes the Bun acceptance process and is attributable context, not isolated client heap'],
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
