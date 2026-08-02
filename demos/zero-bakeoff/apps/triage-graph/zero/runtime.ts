import {spawn} from 'node:child_process';
import {mkdir, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import postgres from 'postgres';
import {Zero, mustGetMutator, mustGetQuery} from '@rocicorp/zero';
import {handleMutateRequest, handleQueryRequest} from '@rocicorp/zero/server';
import {zeroPostgresJS} from '@rocicorp/zero/server/adapters/postgresjs';
import {batches, generateTriageFixture} from '../fixture.mjs';
import {mutators} from './mutators.ts';
import {queries} from './queries.ts';
import {schema, type AuthContext} from './schema.ts';

const programRoot = resolve(import.meta.dirname, '../../..');

async function freePort() {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function databaseURL(base: string, name: string) {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function prepareDatabase(baseURL: string, name: string) {
  if (!/^tg_bakeoff_[a-z0-9_]+$/.test(name)) throw new Error('unsafe test database name');
  const admin = postgres(baseURL, {max: 1});
  await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${name}`);
  await admin.end();
  const sql = postgres(databaseURL(baseURL, name), {max: 20});
  await sql.unsafe(`
    CREATE TABLE tg_user (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE tg_organization (id text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE tg_team (id text PRIMARY KEY, "organizationID" text NOT NULL REFERENCES tg_organization(id), name text NOT NULL);
    CREATE TABLE tg_membership (id text PRIMARY KEY, "teamID" text NOT NULL REFERENCES tg_team(id), "userID" text NOT NULL REFERENCES tg_user(id));
    CREATE UNIQUE INDEX tg_membership_team_user ON tg_membership ("teamID", "userID");
    CREATE TABLE tg_project (id text PRIMARY KEY, "teamID" text NOT NULL REFERENCES tg_team(id), name text NOT NULL);
    CREATE TABLE tg_label (id text PRIMARY KEY, "teamID" text NOT NULL REFERENCES tg_team(id), name text NOT NULL);
    CREATE TABLE tg_issue (id text PRIMARY KEY, "teamID" text NOT NULL REFERENCES tg_team(id), "projectID" text NOT NULL REFERENCES tg_project(id), "assigneeID" text NOT NULL REFERENCES tg_user(id), title text NOT NULL, status text NOT NULL, priority text NOT NULL, "pageKey" text NOT NULL UNIQUE, "commentCount" double precision NOT NULL, "updatedAt" double precision NOT NULL);
    CREATE INDEX tg_issue_team_page ON tg_issue ("teamID", "pageKey" DESC);
    CREATE INDEX tg_issue_assignee_page ON tg_issue ("assigneeID", "pageKey" DESC);
    CREATE TABLE tg_issue_label (id text PRIMARY KEY, "issueID" text NOT NULL REFERENCES tg_issue(id), "labelID" text NOT NULL REFERENCES tg_label(id));
    CREATE UNIQUE INDEX tg_issue_label_pair ON tg_issue_label ("issueID", "labelID");
    CREATE TABLE tg_comment (id text PRIMARY KEY, "issueID" text NOT NULL REFERENCES tg_issue(id), "authorID" text NOT NULL REFERENCES tg_user(id), body text NOT NULL, "createdAt" double precision NOT NULL);
    CREATE INDEX tg_comment_issue_time ON tg_comment ("issueID", "createdAt" DESC);
    CREATE TABLE tg_activity (id text PRIMARY KEY, "issueID" text NOT NULL REFERENCES tg_issue(id), kind text NOT NULL, "createdAt" double precision NOT NULL);
    CREATE INDEX tg_activity_issue_time ON tg_activity ("issueID", "createdAt" DESC);
  `);
  const fixture = generateTriageFixture();
  await sql`INSERT INTO tg_user ${sql(fixture.users.map((row) => ({id: row.userKey, name: row.name})) )}`;
  await sql`INSERT INTO tg_organization ${sql(fixture.organizations.map((row) => ({id: row.organizationKey, name: row.name})) )}`;
  await sql`INSERT INTO tg_team ${sql(fixture.teams.map((row) => ({id: row.teamKey, organizationID: row.organizationKey, name: row.name})) )}`;
  await sql`INSERT INTO tg_membership ${sql(fixture.memberships.map((row) => ({id: row.membershipKey, teamID: row.teamKey, userID: row.userKey})) )}`;
  await sql`INSERT INTO tg_project ${sql(fixture.projects.map((row) => ({id: row.projectKey, teamID: row.teamKey, name: row.name})) )}`;
  await sql`INSERT INTO tg_label ${sql(fixture.labels.map((row) => ({id: row.labelKey, teamID: row.teamKey, name: row.name})) )}`;
  for (const rows of batches(fixture.issues, 2_000)) await sql`INSERT INTO tg_issue ${sql(rows.map((row) => ({id: row.issueKey, teamID: row.teamKey, projectID: row.projectKey, assigneeID: row.assigneeKey, title: row.title, status: row.status, priority: row.priority, pageKey: row.pageKey, commentCount: row.commentCount, updatedAt: row.updatedAt})) )}`;
  for (const rows of batches(fixture.issueLabels, 2_000)) await sql`INSERT INTO tg_issue_label ${sql(rows.map((row) => ({id: row.issueLabelKey, issueID: row.issueKey, labelID: row.labelKey})) )}`;
  for (const rows of batches(fixture.comments, 2_000)) await sql`INSERT INTO tg_comment ${sql(rows.map((row) => ({id: row.commentKey, issueID: row.issueKey, authorID: row.authorKey, body: row.body, createdAt: row.createdAt})) )}`;
  for (const rows of batches(fixture.activities, 2_000)) await sql`INSERT INTO tg_activity ${sql(rows.map((row) => ({id: row.activityKey, issueID: row.issueKey, kind: row.kind, createdAt: row.createdAt})) )}`;
  return {sql, fixture};
}

function actor(request: Request): string | null {
  const value = request.headers.get('authorization');
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

export async function startTriageZeroRuntime() {
  const baseURL = process.env.ZERO_BAKEOFF_POSTGRES_URL;
  if (!baseURL) throw Object.assign(new Error('ZERO_BAKEOFF_POSTGRES_URL is required'), {code: 'ZERO_BAKEOFF_POSTGRES_UNAVAILABLE'});
  const runID = `${process.pid}_${Date.now()}`;
  const database = `tg_bakeoff_${runID}`;
  const runtimeDir = resolve(import.meta.dirname, '..', '.runtime', runID);
  await mkdir(runtimeDir, {recursive: true});
  const {sql, fixture} = await prepareDatabase(baseURL, database);
  const dbProvider = zeroPostgresJS(schema, sql);
  const api = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const userID = actor(request);
      if (!userID || !['alice', 'bob', 'mallory'].includes(userID)) return new Response('unauthorized', {status: 401});
      const ctx: AuthContext = {userID};
      const pathname = new URL(request.url).pathname;
      if (pathname === '/query') {
        const result = await handleQueryRequest({handler: (name, args) => mustGetQuery(queries, name).fn({args, ctx}), request, schema, userID});
        return Response.json(result);
      }
      if (pathname === '/mutate') {
        const result = await handleMutateRequest({
          dbProvider, request, userID,
          handler: (transact) => transact((tx, name, args) => mustGetMutator(mutators, name).fn({tx, args, ctx})),
        });
        return Response.json(result);
      }
      return new Response('not found', {status: 404});
    },
  });
  const port = await freePort();
  const cacheURL = `http://127.0.0.1:${port}`;
  const cache = spawn(resolve(programRoot, 'node_modules/.bin/zero-cache-dev'), [
    '--port', String(port), '--replica-file', resolve(runtimeDir, 'zero.db'), '--log-level', 'warn',
  ], {
    cwd: programRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env,
      PATH: `${resolve(programRoot, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
      ZERO_UPSTREAM_DB: databaseURL(baseURL, database), ZERO_APP_ID: `tg_${runID}`,
      ZERO_QUERY_URL: `${api.url}query`, ZERO_MUTATE_URL: `${api.url}mutate`,
      ZERO_LOG_LEVEL: 'warn', ZERO_NUM_SYNC_WORKERS: '1', ZERO_CVR_MAX_CONNS: '2', ZERO_UPSTREAM_MAX_CONNS: '2',
    },
  });
  let logs = '';
  cache.stdout?.on('data', (chunk) => { logs += chunk; });
  cache.stderr?.on('data', (chunk) => { logs += chunk; });
  const clients: Zero<any, any, AuthContext>[] = [];
  const client = (userID: string) => {
    const zero = new Zero({schema, mutators, cacheURL, auth: userID, userID, context: {userID}, kvStore: 'mem', storageKey: `${runID}-${userID}-${clients.length}`});
    clients.push(zero);
    return zero;
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const zero of clients.reverse()) await zero.close();
    if (cache.exitCode === null) {
      process.kill(-cache.pid!, 'SIGTERM');
      await Promise.race([new Promise((resolveExit) => cache.once('exit', resolveExit)), Bun.sleep(5_000)]);
      if (cache.exitCode === null) {
        process.kill(-cache.pid!, 'SIGKILL');
        await Promise.race([new Promise((resolveExit) => cache.once('exit', resolveExit)), Bun.sleep(2_000)]);
      }
    }
    api.stop(true);
    await sql.end();
    const admin = postgres(baseURL, {max: 1});
    const slots = await admin<{slot_name: string; active_pid: number | null}[]>`
      SELECT slot_name, active_pid FROM pg_replication_slots WHERE database = ${database}
    `;
    for (const slot of slots) {
      if (slot.active_pid) await admin`SELECT pg_terminate_backend(${slot.active_pid})`;
    }
    await Bun.sleep(100);
    for (const slot of slots) {
      await admin`SELECT pg_drop_replication_slot(${slot.slot_name}) WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = ${slot.slot_name})`;
    }
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
    await rm(runtimeDir, {recursive: true, force: true});
  };
  try {
    const deadline = Date.now() + 30_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (cache.exitCode !== null) throw Object.assign(new Error(`zero-cache exited: ${logs.slice(-4000)}`), {code: 'ZERO_BAKEOFF_ZERO_CACHE_EXITED'});
      try {
        if ((await fetch(`${cacheURL}/keepalive`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    if (!ready) throw Object.assign(new Error(`zero-cache readiness timed out: ${logs.slice(-4000)}`), {code: 'ZERO_BAKEOFF_ZERO_CACHE_TIMEOUT'});
  } catch (error) {
    await close();
    throw error;
  }
  return {cacheURL, client, close, fixture, sql, logs: () => logs};
}
