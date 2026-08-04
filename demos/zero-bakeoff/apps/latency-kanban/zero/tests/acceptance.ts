import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

import { Zero } from '@rocicorp/zero';
import postgres from 'postgres';
// @ts-expect-error shared program harness is intentionally plain ESM.
import {
  assert,
  assertEqual,
  createArmSuite,
  eventually,
  loadAcceptanceVersion,
  loadNetworkCondition,
} from '../../../../shared/harness.mjs';
import { startApi } from '../api.ts';
import { mutators } from '../mutators.ts';
import { queries } from '../queries.ts';
import { schema } from '../schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const zeroBakeoffRoot = resolve(appDir, '..', '..');
const manifest = await loadAcceptanceVersion('latency-kanban', 'v2');
const networkCondition = await loadNetworkCondition(manifest, 'zero');
const suite = createArmSuite({
  app: 'latency-kanban', provider: 'zero', manifest,
  evidencePath: join(appDir, 'evidence', 'zero.v1.json'),
});
const basePG = process.env.ZERO_BAKEOFF_PG_URL ?? 'postgresql://ccheever@127.0.0.1:55186/postgres';
const dbName = `zb_lk_${process.pid}`;
const zeroAppID = `lk${process.pid}`;
const work = await mkdtemp(join(tmpdir(), 'zero-bakeoff-lk-'));
const axes: Record<string, unknown>[] = [];
let cache: ChildProcess | undefined;
let api: ReturnType<typeof startApi> | undefined;
let admin = postgres(basePG, { max: 1 });
let db: ReturnType<typeof postgres> | undefined;
const clients: Zero[] = [];
let cleanupCheckNeeded = false;

function assertLatencyWindow(value: number, window: {floorMs: number; toleranceMs: number}, label: string) {
  assert(value >= window.floorMs,
    `${label} ${value.toFixed(3)}ms was below ${window.floorMs}ms profile floor`);
  assert(value <= window.floorMs + window.toleranceMs,
    `${label} ${value.toFixed(3)}ms exceeded ${window.floorMs + window.toleranceMs}ms window ceiling`);
}

function databaseURL(name: string) {
  const url = new URL(basePG);
  url.pathname = `/${name}`;
  return url.href;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => server.listen(0, '127.0.0.1', resolvePromise).once('error', reject));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  return port;
}
async function stopChild(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise()));
  const signalTree = (signal: NodeJS.Signals) => {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  };
  signalTree('SIGTERM');
  await Promise.race([exited, Bun.sleep(3_000)]);
  if (child.exitCode === null) {
    signalTree('SIGKILL');
    await Promise.race([exited, Bun.sleep(3_000)]);
  }
}
function openClient(userID: string, cacheURL: string) {
  const zero = new Zero({
    userID, cacheURL, schema, mutators, context: { userID }, kvStore: 'mem',
    mutateHeaders: { 'x-bakeoff-user': userID },
    queryHeaders: { 'x-bakeoff-user': userID },
    logLevel: 'error',
  });
  clients.push(zero);
  return zero;
}
async function board(zero: Zero) {
  return await zero.run(queries.board());
}

try {
  await admin.unsafe(`create database ${dbName}`);
  db = postgres(databaseURL(dbName), { max: 10 });
  await db.unsafe(`
    create table kanban_column (id text primary key, title text not null, rank bigint not null);
    create table kanban_card (
      id text primary key, title text not null, column_id text not null references kanban_column(id),
      rank bigint not null, assignee_id text not null, archived bigint not null,
      locked bigint not null, revision bigint not null
    );
  `);
  await db.begin(async (sql) => {
    for (let i = 0; i < 4; i += 1) await sql`insert into kanban_column ${sql({ id: `c${i}`, title: ['Backlog', 'Ready', 'Doing', 'Done'][i], rank: i })}`;
    for (let i = 0; i < 500; i += 1) await sql`insert into kanban_card ${sql({
      id: `card-${String(i).padStart(3, '0')}`, title: `Deterministic card ${i}`,
      column_id: `c${i % 4}`, rank: Math.floor(i / 4) * 100,
      assignee_id: ['alice', 'bob', 'cara'][i % 3], archived: 0, locked: i === 7 ? 1 : 0, revision: 0,
    })}`;
  });
  api = startApi(databaseURL(dbName), networkCondition.profile.mutationAckDelayMs);
  const cachePort = await freePort();
  const cacheURL = `http://127.0.0.1:${cachePort}`;
  const cacheBin = join(zeroBakeoffRoot, 'node_modules', '.bin', 'zero-cache-dev');
  cache = spawn(cacheBin, [], {
    cwd: appDir,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PATH: `${join(zeroBakeoffRoot, 'node_modules', '.bin')}:${join(appDir, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      ZERO_UPSTREAM_DB: databaseURL(dbName),
      ZERO_APP_ID: zeroAppID,
      ZERO_REPLICA_FILE: join(work, 'replica.db'),
      ZERO_PORT: String(cachePort),
      ZERO_QUERY_URL: `${api.url}/query`,
      ZERO_MUTATE_URL: `${api.url}/mutate`,
      ZERO_QUERY_ALLOWED_CLIENT_HEADERS: 'x-bakeoff-user',
      ZERO_MUTATE_ALLOWED_CLIENT_HEADERS: 'x-bakeoff-user',
      ZERO_SCHEMA_FILE: join(appDir, 'zero', 'schema.ts'),
      ZERO_LOG_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cacheLog = '';
  cache.stdout?.on('data', (chunk) => { cacheLog += chunk; });
  cache.stderr?.on('data', (chunk) => { cacheLog += chunk; });
  await eventually(async () => {
    if (cache?.exitCode !== null) throw new Error(`zero-cache exited ${cache?.exitCode}: ${cacheLog.slice(-2000)}`);
    return (await fetch(`${cacheURL}/keepalive`).catch(() => null))?.ok;
  }, { timeoutMs: 30_000, label: 'zero-cache keepalive' });

  const alice = openClient('alice', cacheURL);
  const bob = openClient('bob', cacheURL);
  const observer = openClient('observer', cacheURL);
  await eventually(async () => (await board(alice)).length === 500, { timeoutMs: 30_000, label: '500-card hydration' });
  await eventually(async () => (await board(observer)).length === 500, { timeoutMs: 30_000, label: 'observer hydration' });
  cleanupCheckNeeded = true;

  await suite.pass('lk.one-frame-local-paint', async () => {
    const card = (await board(alice)).find((row) => !row.locked)!;
    const inputAt = performance.now();
    const mutation = alice.mutate(mutators.card.move({
      id: card.id, columnID: 'c3', rank: 5, expectedRevision: card.revision,
    }));
    await mutation.client;
    const paintedAt = performance.now();
    assertEqual((await board(alice)).find((row) => row.id === card.id)?.columnID, 'c3', 'client mutator paints local row');
    await mutation.server;
    const acknowledgedAt = performance.now();
    const sample = { inputToPaintMs: paintedAt - inputAt, acknowledgementMs: acknowledgedAt - inputAt };
    axes.push(sample);
    assert(sample.inputToPaintMs < 16.7, `local mutator missed one frame: ${sample.inputToPaintMs}`);
    assertLatencyWindow(sample.acknowledgementMs, networkCondition.windows.actorAck,
      'actor acknowledgement');
    return sample;
  });

  await suite.pass('lk.rapid-move-integrity', async () => {
    const rows = (await board(alice)).filter((row) => !row.locked && row.revision === 0).slice(0, 20);
    const mutations = rows.map((card, index) => alice.mutate(mutators.card.move({
      id: card.id, columnID: `c${(index + 1) % 4}`, rank: 10_000 + index, expectedRevision: 0,
    })));
    await Promise.all(mutations.map((mutation) => mutation.client));
    await Promise.all(mutations.map((mutation) => mutation.server));
    const current = await board(alice);
    assertEqual(current.length, 500, 'rapid moves preserve cardinality');
    assertEqual(new Set(current.map((row) => row.id)).size, 500, 'rapid moves preserve unique cards');
    return { cards: current.length, unique: 500 };
  });

  await suite.pass('lk.locked-card-correction', async () => {
    const card = (await board(alice)).find((row) => row.locked)!;
    const mutation = alice.mutate(mutators.card.move({
      id: card.id, columnID: 'c3', rank: 1, expectedRevision: card.revision,
    }));
    await mutation.client;
    assertEqual((await board(alice)).find((row) => row.id === card.id)?.columnID, 'c3', 'locked prediction rendered');
    const result = await mutation.server;
    assertEqual(result.type, 'error', 'locked authority returns an application error result');
    await eventually(async () => (await board(alice)).find((row) => row.id === card.id)?.columnID === card.columnID,
      { label: 'locked prediction rollback' });
    return { rejected: true, serverResult: result, actionable: 'CARD_LOCKED; choose an unlocked card' };
  });

  await suite.pass('lk.pending-reload', async () => {
    const card = (await board(alice)).find((row) => !row.locked && row.revision === 0)!;
    const mutation = alice.mutate(mutators.card.move({
      id: card.id, columnID: 'c2', rank: 20_000, expectedRevision: 0,
    }));
    await mutation.client;
    assertEqual((await board(observer)).find((row) => row.id === card.id)?.revision, 0,
      'new view does not confuse prediction with authority');
    await mutation.server;
    await eventually(async () => (await board(observer)).find((row) => row.id === card.id)?.revision === 1,
      { label: 'reloaded observer settled authority' });
    return { behavior: 'memory cache does not reconstruct pending work; a still-live Zero owner settles and a new view converges' };
  });

  await suite.pass('lk.concurrent-move-convergence', async () => {
    const card = (await board(alice)).find((row) => !row.locked && row.revision === 0)!;
    const a = alice.mutate(mutators.card.move({ id: card.id, columnID: 'c1', rank: 30_001, expectedRevision: 0 }));
    const b = bob.mutate(mutators.card.move({ id: card.id, columnID: 'c2', rank: 30_002, expectedRevision: 0 }));
    await Promise.all([a.client, b.client]);
    const outcomes = await Promise.all([a.server, b.server]);
    assertEqual(outcomes.filter((entry) => entry.type === 'success').length, 1, 'one CAS contender wins');
    assertEqual(outcomes.filter((entry) => entry.type === 'error').length, 1, 'one CAS contender corrects');
    await eventually(async () => (await board(observer)).find((row) => row.id === card.id)?.revision === 1,
      { label: 'concurrent canonical revision' });
    const canonical = (await board(observer)).find((row) => row.id === card.id)!;
    return { winner: canonical.columnID, revision: canonical.revision, serverResults: outcomes };
  });

  await suite.pass('lk.independent-observer', async () => {
    const card = (await board(alice)).find((row) => !row.locked && row.revision === 0)!;
    const started = performance.now();
    const mutation = alice.mutate(mutators.card.move({ id: card.id, columnID: 'c3', rank: 40_000, expectedRevision: 0 }));
    await mutation.server;
    await eventually(async () => (await board(observer)).find((row) => row.id === card.id)?.revision === 1,
      { label: 'independent Zero observer' });
    const sample = { observerConvergenceMs: performance.now() - started, transport: 'Zero materialized query over websocket' };
    axes.push(sample);
    assertLatencyWindow(sample.observerConvergenceMs, networkCondition.windows.observerDelta,
      'observer delta');
    return sample;
  });

  await suite.pass('lk.latency-axes', async () => {
    assert(axes.some((entry) => entry.inputToPaintMs !== undefined), 'local paint measured');
    assert(axes.some((entry) => entry.acknowledgementMs !== undefined), 'server acknowledgement measured');
    assert(axes.some((entry) => entry.observerConvergenceMs !== undefined), 'observer convergence measured');
    for (const entry of axes) {
      if (typeof entry.acknowledgementMs === 'number') {
        assertLatencyWindow(entry.acknowledgementMs, networkCondition.windows.actorAck,
          'actor acknowledgement');
      }
      if (typeof entry.observerConvergenceMs === 'number') {
        assertLatencyWindow(entry.observerConvergenceMs, networkCondition.windows.observerDelta,
          'observer delta');
      }
    }
    return { samples: axes };
  });

} catch (error) {
  for (const id of manifest.checks) await suite.gap(id, 'Zero local runtime unavailable before acceptance', {
    code: (error as { code?: string })?.code ?? 'ZERO_RUNTIME_GAP', message: String((error as Error)?.message ?? error),
  });
}

for (const client of clients.reverse()) await client.close();
await stopChild(cache);
await api?.close();
await db?.end({ timeout: 2 });
if (cleanupCheckNeeded) await suite.pass('lk.cleanup', async () => {
  await eventually(async () => !(await admin<{ active: boolean }[]>`
    select active from pg_replication_slots where database = ${dbName}
  `).some((slot) => slot.active), { timeoutMs: 10_000, label: 'Zero replication slot retirement' });
  const slotsToDrop = await admin<{ slot_name: string }[]>`
    select slot_name from pg_replication_slots where database = ${dbName}
  `;
  for (const slot of slotsToDrop) await admin`select pg_drop_replication_slot(${slot.slot_name})`;
  await admin`
    select pg_terminate_backend(pid)
    from pg_stat_activity
    where datname = ${dbName} and pid <> pg_backend_pid()
  `;
  assert(/^[a-z0-9_]+$/.test(dbName), 'generated database name is not a safe SQL identifier');
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
  const databases = await admin<{ datname: string }[]>`select datname from pg_database where datname = ${dbName}`;
  const slots = await admin<{ slot_name: string }[]>`select slot_name from pg_replication_slots where database = ${dbName}`;
  assertEqual(databases.length, 0, 'owned database removed');
  assertEqual(slots.length, 0, 'owned replication slots removed');
  return { owned: ['three Zero clients', 'zero-cache-dev process tree', 'API server', 'replica file', dbName],
    shared: ['PostgreSQL server'], removed: true };
});
await admin.end({ timeout: 2 });
await rm(work, { recursive: true, force: true });

const receipt = await suite.finish({
  providerIdentity: { product: 'Zero', version: '1.8.0', target: 'zero-cache-dev/PostgreSQL 17' },
  fixture: manifest.fixture,
  networkCondition: {
    schemaVersion: networkCondition.environment.schemaVersion,
    profile: networkCondition.profile,
    windows: networkCondition.windows,
    injectionPoint: networkCondition.injectionPoint,
  },
  latency: { samples: axes },
  nonclaims: ['kvStore=mem makes pending reload behavior non-durable; no offline write claim'],
  zeroAppID,
});
console.log(JSON.stringify(receipt));
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
