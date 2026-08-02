import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {SnapbackClient} from '../../../../_kit/client.mjs';
import {startServer} from '../../../../_kit/server-process.mjs';
import {assert, assertEqual, createArmSuite, eventually, loadAcceptance} from '../../../shared/harness.mjs';
import {batches, eventBatches, generateFleetDimensions, telemetryBurst} from '../fixture.mjs';
import api from './generated/api.mjs';

// @ref LLP 0138#the-six-application-contracts — A6 measures bounded custody,
// filter churn, live burst convergence, active views, and restart behavior.
const repoRoot = resolve(import.meta.dirname, '../../../../..');
const generated = resolve(import.meta.dirname, 'generated');
const manifest = await loadAcceptance('fleet-observatory');
const suite = createArmSuite({
  app: 'fleet-observatory', provider: 'snapback', manifest,
  evidencePath: resolve(import.meta.dirname, '..', 'evidence', 'snapback.v2.json'),
});
const json = async (name) => JSON.parse(await readFile(resolve(generated, name), 'utf8'));

let server;
try {
  server = await startServer({
    db: ':memory:', cwd: repoRoot,
    serverBinary: process.env.SNAPBACK_SERVER_BINARY ?? resolve(repoRoot, 'target/debug/snapback'),
    provenance: {appId: 'fleet-observatory', artifactsPath: resolve(generated, 'artifacts.json')},
  });
  suite.cleanup(() => server.stop());
  const client = new SnapbackClient(server.baseUrl, server.clientOptions);
  await client.loadSchema(await json('schema.manifest.json'));
  await client.loadFunctions(await json('functions.manifest.json'));
  await client.reset();

  const dimensions = generateFleetDimensions();
  for (const kind of ['fleets', 'memberships', 'owners', 'devices']) {
    const tableKind = kind === 'memberships' ? 'fleetMemberships' : kind;
    for (const rows of batches(dimensions[kind])) {
      const result = await client.mutate(api.ingestFixtureBatch, {args: {kind: tableKind, rows}, userId: 'alice'});
      assertEqual(result.result, rows.length, `fixture ingestion count for ${kind}`);
    }
  }
  for (const rows of eventBatches()) {
    const result = await client.mutate(api.ingestFixtureBatch, {args: {kind: 'events', rows}, userId: 'alice'});
    assertEqual(result.result, rows.length, 'event fixture ingestion count');
  }

  await suite.pass('fo.initial-bounded-slice', async () => {
    const rows = (await client.query(api.latestEvents, {args: {fleetKey: 'fleet-0', severity: 'critical'}, userId: 'alice'})).rows;
    assertEqual(rows.length, 100, 'initial route must contain exactly 100 events');
    assert(rows.every((row) => row.fleetKey === 'fleet-0' && row.severity === 'critical' && row.deviceName && row.ownerName), 'bounded route omitted a relation or admitted a nonmatch');
    return {rows: rows.length, bytes: Buffer.byteLength(JSON.stringify(rows))};
  });

  await suite.pass('fo.first-useful-vs-complete', async () => {
    const started = performance.now();
    const view = await client.liveQuery(api.latestEvents, {
      args: {fleetKey: 'fleet-0', severity: 'critical', region: 'iad'}, userId: 'alice',
      connectionId: 'fleet-first-useful', transport: 'stream', fallbackToPoll: false,
    });
    const completeMs = performance.now() - started;
    const firstUsefulMs = view.rows.length > 0 ? completeMs : null;
    view.dispose();
    assert(firstUsefulMs !== null, 'authoritative initial snapshot contained no useful rows');
    return {firstUsefulMs, completeMs, semantics: 'initial response is one authoritative snapshot'};
  });

  await suite.pass('fo.filter-churn-custody', async () => {
    const samples = [];
    for (let index = 0; index < 20; index += 1) {
      const args = {
        fleetKey: 'fleet-0', severity: 'critical',
        region: ['iad', 'sfo', 'fra', 'sin', 'syd'][index % 5],
        deviceStatus: ['healthy', 'degraded', 'offline'][index % 3],
      };
      const started = performance.now();
      const rows = (await client.query(api.latestEvents, {args, userId: 'alice'})).rows;
      samples.push(performance.now() - started);
      assert(rows.every((row) => row.region === args.region && row.deviceStatus === args.deviceStatus), `predecessor rows leaked into filter ${index}`);
    }
    return {switches: 20, samplesMs: samples, custody: 'server result only; headless client has no persistent row store'};
  });

  const observer = await client.liveQuery(api.latestEvents, {
    args: {fleetKey: 'fleet-0', severity: 'critical'}, userId: 'bob',
    connectionId: 'fleet-observer', transport: 'poll',
  });
  suite.cleanup(() => observer.dispose());

  await suite.pass('fo.matching-update-convergence', async () => {
    const updates = telemetryBurst();
    const started = performance.now();
    const mutation = await client.mutate(api.applyTelemetryBurst, {args: {updates}, userId: 'bob'});
    const serverSettlementMs = performance.now() - started;
    assertEqual(mutation.result, 1_000, 'burst did not patch all events');
    try {
      await eventually(async () => {
        await observer.poll();
        return observer.rows.filter((row) => row.message.startsWith('Burst-updated')).length === 100;
      }, {timeoutMs: 30_000, intervalMs: 50, label: '100 matching Snapback updates'});
    } catch (cause) {
      const direct = (await client.query(api.latestEvents, {args: {fleetKey: 'fleet-0', severity: 'critical'}, userId: 'bob'})).rows;
      const directMatches = direct.filter((row) => row.message.startsWith('Burst-updated')).length;
      const liveMatches = observer.rows.filter((row) => row.message.startsWith('Burst-updated')).length;
      const error = new Error(`live burst did not converge: directMatches=${directMatches}, liveMatches=${liveMatches}, connection=${observer.connection}`, {cause});
      error.code = directMatches === 100
        ? 'SNAPBACK_BAKEOFF_LIVE_BURST_STALE'
        : 'SNAPBACK_BAKEOFF_BURST_NOT_VISIBLE';
      throw error;
    }
    return {updates: 1_000, activeMatches: 100, serverSettlementMs, clientSettlementMs: performance.now() - started};
  });

  await suite.pass('fo.no-full-dataset-transfer', async () => {
    const resultBytes = Buffer.byteLength(JSON.stringify(observer.rows));
    assertEqual(observer.rows.length, 100, 'bounded observer exceeded its route limit');
    return {fixtureEvents: 250_000, currentResultRows: observer.rows.length, resultBytes, custody: 'authoritative result projection, not a replicated client table'};
  });

  await suite.pass('fo.active-view-resources', async () => {
    const views = [];
    const hydrationMs = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const view = await client.liveQuery(api.latestEvents, {
        args: {
          fleetKey: `fleet-${index % 5}`, severity: 'critical',
          region: ['iad', 'sfo', 'fra', 'sin', 'syd'][index % 5],
          deviceStatus: ['healthy', 'degraded', 'offline'][index % 3],
        },
        userId: 'bob', connectionId: `fleet-active-${index}`, transport: 'stream', fallbackToPoll: false,
      });
      views.push(view);
      hydrationMs.push(performance.now() - started);
    }
    const resources = {views: views.length, retainedResultRows: views.reduce((sum, view) => sum + view.rows.length, 0), processRssBytes: process.memoryUsage().rss, hydrationMs};
    for (const view of views) view.dispose();
    assertEqual(resources.views, 20, 'twenty views were not active');
    return resources;
  });

  await suite.gap('fo.warm-cold-restart', 'Headless acceptance uses Snapback in-memory client state; browser retained-store warm/cold restart requires the browser carrier', {code: 'SNAPBACK_BAKEOFF_BROWSER_RETAINED_STORE_REQUIRED'});

  await suite.pass('fo.outsider-nonreplication', async () => {
    const rows = (await client.query(api.latestEvents, {args: {fleetKey: 'fleet-0', severity: 'critical'}, userId: 'mallory'})).rows;
    assertEqual(rows.length, 0, 'Mallory received protected event rows');
    return {queryRows: 0, clientRetainedRows: 0, custody: 'no protected result bytes delivered'};
  });
} catch (error) {
  for (const id of manifest.checks) {
    try {
      await suite.gap(id, 'Snapback full-scale runtime was unavailable before the check could execute', {code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_RUNTIME_UNAVAILABLE', message: String(error?.message ?? error)});
    } catch (duplicate) {
      if (!String(duplicate?.message ?? duplicate).includes('ZERO_BAKEOFF_DUPLICATE_CHECK')) throw duplicate;
    }
  }
}

const receipt = await suite.finish({
  target: {providerVersion: `source@${server?.identity?.binary?.gitCommit ?? 'unknown'}`, dirty: server?.identity?.binary?.gitDirty ?? true, identityVerdict: server?.identity?.verdict ?? 'unavailable', runtime: 'debug Ibex/SQLite', clientStore: 'headless memory'},
  fixture: manifest.fixture,
  nonclaims: ['No hosted Snapback claim', 'Browser retained-store restart is a retained GAP', 'Process RSS includes the Node acceptance process and is attributable context, not isolated client heap'],
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
