import {spawn} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {Zero, mustGetMutator, mustGetQuery} from '@rocicorp/zero';
import {handleMutateRequest, handleQueryRequest} from '@rocicorp/zero/server';
import {zeroPostgresJS} from '@rocicorp/zero/server/adapters/postgresjs';
import {batches, eventBatches, generateFleetDimensions} from '../fixture.mjs';
import {mutators} from './mutators.ts';
import {queries} from './queries.ts';
import {schema, type AuthContext} from './schema.ts';

const programRoot = resolve(import.meta.dirname, '../../..');
const databaseURL = (base: string, name: string) => { const url = new URL(base); url.pathname = `/${name}`; return url.toString(); };
async function freePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer(); server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0)); });
  });
}

async function prepareDatabase(baseURL: string, name: string) {
  if (!/^fo_bakeoff_[a-z0-9_]+$/.test(name)) throw new Error('unsafe test database name');
  const admin = postgres(baseURL, {max: 1});
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const sql = postgres(databaseURL(baseURL, name), {max: 20});
  await sql.unsafe(`
    CREATE TABLE fo_fleet (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE fo_membership (id text PRIMARY KEY, "fleetID" text NOT NULL REFERENCES fo_fleet(id), "userID" text NOT NULL);
    CREATE UNIQUE INDEX fo_membership_fleet_user ON fo_membership ("fleetID", "userID");
    CREATE TABLE fo_owner (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE fo_device (id text PRIMARY KEY, "fleetID" text NOT NULL REFERENCES fo_fleet(id), "ownerID" text NOT NULL REFERENCES fo_owner(id), name text NOT NULL, region text NOT NULL, status text NOT NULL, "updatedAt" double precision NOT NULL);
    CREATE INDEX fo_device_fleet_region_status ON fo_device ("fleetID", region, status, id);
    CREATE TABLE fo_event (id text PRIMARY KEY, "deviceID" text NOT NULL REFERENCES fo_device(id), "fleetID" text NOT NULL REFERENCES fo_fleet(id), "ownerID" text NOT NULL REFERENCES fo_owner(id), "deviceStatus" text NOT NULL, region text NOT NULL, severity text NOT NULL, message text NOT NULL, "pageKey" text NOT NULL UNIQUE, "occurredAt" double precision NOT NULL);
    CREATE INDEX fo_event_fleet_page ON fo_event ("fleetID", "pageKey" DESC);
    CREATE INDEX fo_event_fleet_severity_page ON fo_event ("fleetID", severity, "pageKey" DESC);
  `);
  const dimensions = generateFleetDimensions();
  await sql`INSERT INTO fo_fleet ${sql(dimensions.fleets.map((row) => ({id: row.fleetKey, name: row.name})) )}`;
  await sql`INSERT INTO fo_membership ${sql(dimensions.memberships.map((row) => ({id: row.membershipKey, fleetID: row.fleetKey, userID: row.userKey})) )}`;
  await sql`INSERT INTO fo_owner ${sql(dimensions.owners.map((row) => ({id: row.ownerKey, name: row.name})) )}`;
  for (const rows of batches(dimensions.devices, 5_000)) await sql`INSERT INTO fo_device ${sql(rows.map((row) => ({id: row.deviceKey, fleetID: row.fleetKey, ownerID: row.ownerKey, name: row.name, region: row.region, status: row.status, updatedAt: row.updatedAt})) )}`;
  for (const rows of eventBatches({batchSize: 5_000})) await sql`INSERT INTO fo_event ${sql(rows.map((row) => ({id: row.eventKey, deviceID: row.deviceKey, fleetID: row.fleetKey, ownerID: row.ownerKey, deviceStatus: row.deviceStatus, region: row.region, severity: row.severity, message: row.message, pageKey: row.pageKey, occurredAt: row.occurredAt})) )}`;
  return {sql, dimensions};
}

const actor = (request: Request) => { const value = request.headers.get('authorization'); return value?.startsWith('Bearer ') ? value.slice(7) : null; };

export async function startFleetZeroRuntime() {
  const baseURL = process.env.ZERO_BAKEOFF_POSTGRES_URL;
  if (!baseURL) throw Object.assign(new Error('ZERO_BAKEOFF_POSTGRES_URL is required'), {code: 'ZERO_BAKEOFF_POSTGRES_UNAVAILABLE'});
  const runID = `${process.pid}_${Date.now()}`;
  const database = `fo_bakeoff_${runID}`;
  const runtimeDir = resolve(import.meta.dirname, '..', '.runtime', runID);
  await mkdir(runtimeDir, {recursive: true});
  const {sql, dimensions} = await prepareDatabase(baseURL, database);
  const dbProvider = zeroPostgresJS(schema, sql);
  const api = Bun.serve({hostname: '127.0.0.1', port: 0, async fetch(request) {
    const userID = actor(request);
    if (!userID || !['alice', 'bob', 'mallory'].includes(userID)) return new Response('unauthorized', {status: 401});
    const ctx: AuthContext = {userID};
    const pathname = new URL(request.url).pathname;
    if (pathname === '/query') return Response.json(await handleQueryRequest({handler: (name, args) => mustGetQuery(queries, name).fn({args, ctx}), request, schema, userID}));
    if (pathname === '/mutate') return Response.json(await handleMutateRequest({dbProvider, request, userID, handler: (transact) => transact((tx, name, args) => mustGetMutator(mutators, name).fn({tx, args, ctx}))}));
    return new Response('not found', {status: 404});
  }});
  const port = await freePort();
  const cacheURL = `http://127.0.0.1:${port}`;
  const cache = spawn(resolve(programRoot, 'node_modules/.bin/zero-cache-dev'), ['--port', String(port), '--replica-file', resolve(runtimeDir, 'zero.db'), '--log-level', 'warn'], {
    cwd: programRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      PATH: `${resolve(programRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      ZERO_UPSTREAM_DB: databaseURL(baseURL, database), ZERO_APP_ID: `fo_${runID}`,
      ZERO_QUERY_URL: `${api.url}query`, ZERO_MUTATE_URL: `${api.url}mutate`, ZERO_NUM_SYNC_WORKERS: '1', ZERO_CVR_MAX_CONNS: '2', ZERO_UPSTREAM_MAX_CONNS: '2',
    },
  });
  let logs = ''; cache.stdout?.on('data', (chunk) => { logs += chunk; }); cache.stderr?.on('data', (chunk) => { logs += chunk; });
  const clients: Zero<any, any, AuthContext>[] = [];
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    for (const zero of clients.reverse()) await zero.close();
    if (cache.exitCode === null) {
      process.kill(-cache.pid!, 'SIGTERM');
      await Promise.race([new Promise((resolveExit) => cache.once('exit', resolveExit)), Bun.sleep(5_000)]);
      if (cache.exitCode === null) { process.kill(-cache.pid!, 'SIGKILL'); await Bun.sleep(250); }
    }
    api.stop(true); await sql.end();
    const admin = postgres(baseURL, {max: 1});
    const slots = await admin<{slot_name: string; active_pid: number | null}[]>`SELECT slot_name, active_pid FROM pg_replication_slots WHERE database = ${database}`;
    for (const slot of slots) if (slot.active_pid) await admin`SELECT pg_terminate_backend(${slot.active_pid})`;
    await Bun.sleep(100);
    for (const slot of slots) await admin`SELECT pg_drop_replication_slot(${slot.slot_name}) WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = ${slot.slot_name})`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); await admin.end(); await rm(runtimeDir, {recursive: true, force: true});
  };
  try {
    const deadline = Date.now() + 60_000; let ready = false;
    while (Date.now() < deadline) {
      if (cache.exitCode !== null) throw Object.assign(new Error(`zero-cache exited: ${logs.slice(-4000)}`), {code: 'ZERO_BAKEOFF_ZERO_CACHE_EXITED'});
      try { if ((await fetch(`${cacheURL}/keepalive`)).ok) { ready = true; break; } } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw Object.assign(new Error(`zero-cache readiness timed out: ${logs.slice(-4000)}`), {code: 'ZERO_BAKEOFF_ZERO_CACHE_TIMEOUT'});
  } catch (error) { await close(); throw error; }
  const client = (userID: string) => { const zero = new Zero({schema, mutators, cacheURL, auth: userID, userID, context: {userID}, kvStore: 'mem', storageKey: `${runID}-${userID}-${clients.length}`}); clients.push(zero); return zero; };
  return {cacheURL, client, close, dimensions, sql, logs: () => logs};
}

