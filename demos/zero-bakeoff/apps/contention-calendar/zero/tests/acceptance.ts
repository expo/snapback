import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { performance } from 'node:perf_hooks';

import { Zero, type MutatorResultDetails } from '@rocicorp/zero';
import postgres from 'postgres';
// @ts-expect-error shared program harness is intentionally plain ESM.
import { assert, assertEqual, createArmSuite, eventually, loadAcceptance } from '../../../../shared/harness.mjs';
import { startApi } from '../api.ts';
import { mutators } from '../mutators.ts';
import { queries } from '../queries.ts';
import { schema } from '../schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', '..');
const bakeoffRoot = resolve(appDir, '..', '..');
const manifest = await loadAcceptance('contention-calendar');
const suite = createArmSuite({
  app: 'contention-calendar', provider: 'zero', manifest,
  evidencePath: join(appDir, 'evidence', 'zero.v1.json'),
});
const basePG = process.env.ZERO_BAKEOFF_PG_URL ?? 'postgresql://ccheever@127.0.0.1:55186/postgres';
const dbName = `zb_cc_${process.pid}`;
const zeroAppID = `cc${process.pid}`;
const work = await mkdtemp(join(tmpdir(), 'zero-bakeoff-cc-'));
const latencyMs = 1000;
const now = 1_787_000_000_000;
const clients: Zero[] = [];
let cleanupCheckNeeded = false;
const samples: Record<string, unknown>[] = [];
let cache: ChildProcess | undefined;
let api: ReturnType<typeof startApi> | undefined;
const admin = postgres(basePG, { max: 1 });
let db: ReturnType<typeof postgres> | undefined;

function dbURL(name: string) { const url = new URL(basePG); url.pathname = `/${name}`; return url.href; }
async function freePort() {
  const listener = createServer();
  await new Promise<void>((ok, no) => listener.listen(0, '127.0.0.1', ok).once('error', no));
  const address = listener.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((ok) => listener.close(() => ok()));
  return port;
}
async function stopChild(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise<void>((ok) => child.once('exit', () => ok()));
  const signalTree = (signal: NodeJS.Signals) => {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  };
  signalTree('SIGTERM');
  await Promise.race([exited, Bun.sleep(3000)]);
  if (child.exitCode === null) {
    signalTree('SIGKILL');
    await Promise.race([exited, Bun.sleep(3000)]);
  }
}
function openClient(userID: string, cacheURL: string) {
  const zero = new Zero({ userID, cacheURL, schema, mutators, context: { userID }, kvStore: 'mem',
    mutateHeaders: { 'x-bakeoff-user': userID }, queryHeaders: { 'x-bakeoff-user': userID }, logLevel: 'error' });
  clients.push(zero);
  return zero;
}
const schedule = async (zero: Zero) => await zero.run(queries.schedule());
const args = (id: string, resourceID: string, slotKey: string, ownerID: string) => ({
  id: `reservation:${id}`, idempotencyKey: id, resourceID, slotKey, ownerID,
  title: `${ownerID} reservation`, createdAt: now,
});

try {
  await admin.unsafe(`create database ${dbName}`);
  db = postgres(dbURL(dbName), { max: 10 });
  await db.unsafe(`
    create table calendar_resource (id text primary key, title text not null);
    create table calendar_reservation (
      id text primary key, idempotency_key text not null unique,
      resource_id text not null references calendar_resource(id), slot_key text not null,
      owner_id text not null, title text not null, created_at bigint not null,
      unique (resource_id, slot_key)
    );
  `);
  await db.begin(async (sql) => {
    for (let i = 0; i < 20; i += 1) await sql`insert into calendar_resource ${sql({
      id: `room-${String(i).padStart(2, '0')}`, title: `Room ${String(i).padStart(2, '0')}`,
    })}`;
  });
  api = startApi(dbURL(dbName), latencyMs);
  const cachePort = await freePort();
  const cacheURL = `http://127.0.0.1:${cachePort}`;
  cache = spawn(join(bakeoffRoot, 'node_modules', '.bin', 'zero-cache-dev'), [], {
    cwd: appDir,
    detached: process.platform !== 'win32',
    env: { ...process.env, PATH: `${join(bakeoffRoot, 'node_modules', '.bin')}:${join(appDir, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      ZERO_UPSTREAM_DB: dbURL(dbName), ZERO_APP_ID: zeroAppID, ZERO_REPLICA_FILE: join(work, 'replica.db'),
      ZERO_PORT: String(cachePort), ZERO_QUERY_URL: `${api.url}/query`, ZERO_MUTATE_URL: `${api.url}/mutate`,
      ZERO_QUERY_ALLOWED_CLIENT_HEADERS: 'x-bakeoff-user', ZERO_MUTATE_ALLOWED_CLIENT_HEADERS: 'x-bakeoff-user',
      ZERO_SCHEMA_FILE: join(appDir, 'zero', 'schema.ts'), ZERO_LOG_LEVEL: 'error' },
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
  await eventually(async () => Array.isArray(await schedule(alice)), { timeoutMs: 30_000, label: 'schedule hydration' });
  cleanupCheckNeeded = true;

  await suite.pass('cc.provisional-render', async () => {
    const inputAt = performance.now();
    const mutation = alice.mutate(mutators.reservation.reserve(args('provisional', 'room-19', 'slot-p', 'alice')));
    await mutation.client;
    const paintAt = performance.now();
    assert((await schedule(alice)).some((row) => row.idempotencyKey === 'provisional'), 'client prediction is visible');
    await mutation.server;
    const sample = { inputToPaintMs: paintAt - inputAt, acknowledgementMs: performance.now() - inputAt };
    samples.push(sample);
    assert(sample.inputToPaintMs < 16.7, 'prediction missed one frame');
    assert(sample.acknowledgementMs >= latencyMs, 'ack omitted authority latency');
    return sample;
  });

  let race: MutatorResultDetails[] = [];
  await suite.pass('cc.exactly-one-winner', async () => {
    const a = alice.mutate(mutators.reservation.reserve(args('alice-final', 'room-00', 'slot-final', 'alice')));
    const b = bob.mutate(mutators.reservation.reserve(args('bob-final', 'room-00', 'slot-final', 'bob')));
    await Promise.all([a.client, b.client]);
    race = await Promise.all([a.server, b.server]);
    assertEqual(race.filter((entry) => entry.type === 'success').length, 1, 'exactly one server transaction commits');
    assertEqual(race.filter((entry) => entry.type === 'error').length, 1, 'exactly one server transaction rejects');
    await eventually(async () => (await schedule(observer)).filter((row) => row.resourceID === 'room-00' && row.slotKey === 'slot-final').length === 1,
      { label: 'one canonical winner' });
    const winner = (await schedule(observer)).find((row) => row.resourceID === 'room-00' && row.slotKey === 'slot-final')!;
    return { winner: winner.ownerID, invariant: 'unique(resource_id,slot_key)', serverResults: race };
  });

  await suite.pass('cc.loser-correction', async () => {
    assert(race.some((entry) => entry.type === 'error'), 'race had no loser error result');
    await eventually(async () => {
      const aRows = (await schedule(alice)).filter((row) => row.resourceID === 'room-00' && row.slotKey === 'slot-final');
      const bRows = (await schedule(bob)).filter((row) => row.resourceID === 'room-00' && row.slotKey === 'slot-final');
      return aRows.length === 1 && bRows.length === 1 && aRows[0].id === bRows[0].id;
    }, { label: 'losing prediction rebase' });
    return { corrected: true, alternative: 'room-01|slot-final' };
  });

  await suite.pass('cc.ambiguous-retry-idempotence', async () => {
    const payload = args('retry-safe', 'room-02', 'slot-r', 'alice');
    await alice.mutate(mutators.reservation.reserve(payload)).server;
    await alice.mutate(mutators.reservation.reserve(payload)).server;
    await eventually(async () => (await schedule(observer)).filter((row) => row.idempotencyKey === 'retry-safe').length === 1,
      { label: 'idempotent retry' });
    return { id: payload.id, count: 1 };
  });

  await suite.pass('cc.nonoverlap-success', async () => {
    const a = alice.mutate(mutators.reservation.reserve(args('nonoverlap-a', 'room-03', 'slot-n', 'alice')));
    const b = bob.mutate(mutators.reservation.reserve(args('nonoverlap-b', 'room-04', 'slot-n', 'bob')));
    await Promise.all([a.server, b.server]);
    await eventually(async () => (await schedule(observer)).filter((row) => row.slotKey === 'slot-n').length === 2,
      { label: 'nonoverlap observer' });
    return { committed: 2 };
  });

  await suite.pass('cc.observer-convergence', async () => {
    const started = performance.now();
    await alice.mutate(mutators.reservation.reserve(args('observer', 'room-05', 'slot-o', 'alice'))).server;
    await eventually(async () => (await schedule(observer)).some((row) => row.idempotencyKey === 'observer'),
      { label: 'observer authoritative reservation' });
    return { convergenceMs: performance.now() - started, transport: 'Zero materialized query over websocket' };
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
if (cleanupCheckNeeded) await suite.pass('cc.cleanup', async () => {
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
  latency: { authoritativeMutationMs: latencyMs, samples },
  conflictPolicy: { client: 'shared optimistic mutator', server: 'PostgreSQL unique(resource_id, slot_key)' },
  zeroAppID,
});
console.log(JSON.stringify(receipt));
if (!receipt.ok || receipt.counts.gap > 0) process.exitCode = 1;
