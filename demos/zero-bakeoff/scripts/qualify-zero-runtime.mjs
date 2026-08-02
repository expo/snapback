import {execFileSync, spawn} from 'node:child_process';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {join, resolve} from 'node:path';
import postgres from 'postgres';

const root = resolve(import.meta.dirname, '..');
const runtimeRoot = join(root, '.runtime', 'qualification');
const evidencePath = join(root, 'evidence', 'zero-runtime-qualification.v1.json');
const pgScript = join(root, 'scripts', 'postgres-local.mjs');
const zeroDev = join(root, 'node_modules', '.bin', 'zero-cache-dev');
const zeroSqlite = join(root, 'node_modules', '.bin', 'zero-sqlite3');
const database = `zero_bakeoff_qualification_${process.pid}`;
const replica = join(runtimeRoot, `${database}.db`);

function postgresStatus() {
  return JSON.parse(execFileSync(process.execPath, [pgScript, 'status'], {
    cwd: root,
    encoding: 'utf8'
  }));
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function eventually(fn, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`qualification timed out${lastError ? `: ${lastError.message}` : ''}`);
}

let status = postgresStatus();
let ownsPostgres = false;
if (!status.running) {
  status = JSON.parse(execFileSync(process.execPath, [pgScript, 'start'], {
    cwd: root,
    encoding: 'utf8'
  }));
  ownsPostgres = true;
}

await mkdir(runtimeRoot, {recursive: true});
const admin = postgres(status.url, {max: 1});
let app;
let child;
let logs = '';
const port = await freePort();

try {
  await admin.unsafe(`CREATE DATABASE ${database}`);
  const appUrl = status.url.replace(/\/postgres$/, `/${database}`);
  app = postgres(appUrl, {max: 2});
  await app`
    CREATE TABLE qualification_rows (
      id text PRIMARY KEY,
      title text NOT NULL
    )
  `;
  await app`
    INSERT INTO qualification_rows (id, title)
    VALUES ('qualification-1', 'replicated')
  `;

  child = spawn(zeroDev, [
    '--port', String(port),
    '--replica-file', replica,
    '--log-level', 'warn'
  ], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}`,
      ZERO_UPSTREAM_DB: appUrl,
      ZERO_ENABLE_STARTUP_MESSAGE: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-32_768); });
  child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-32_768); });

  await eventually(async () => (await fetch(`http://127.0.0.1:${port}/keepalive`)).ok);
  const replicated = await eventually(async () => {
    const result = execFileSync(zeroSqlite, [
      replica,
      "SELECT title FROM qualification_rows WHERE id = 'qualification-1'"
    ], {cwd: root, encoding: 'utf8'}).trim();
    return result === 'replicated' ? result : false;
  });

  const packageVersion = JSON.parse(
    await (await import('node:fs/promises')).readFile(join(root, 'node_modules', '@rocicorp', 'zero', 'package.json'), 'utf8')
  ).version;
  const receipt = {
    schemaVersion: 'snapback.zero-bakeoff.zero-runtime-qualification.v1',
    observedAt: new Date().toISOString(),
    ok: true,
    zeroVersion: packageVersion,
    postgresVersion: status.postgresVersion,
    walLevel: (await app`SHOW wal_level`)[0].wal_level,
    keepalive: 200,
    replicatedRow: replicated,
    target: {
      class: 'isolated-local-database',
      host: '127.0.0.1',
      database
    },
    credentialsRequired: false,
    nonclaims: ['Cloud Zero', 'hosted operations', 'production scale']
  };
  await mkdir(join(root, 'evidence'), {recursive: true});
  await writeFile(evidencePath, JSON.stringify(receipt, null, 2) + '\n');
  process.stdout.write(JSON.stringify(receipt) + '\n');
} finally {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
    ]);
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
  }
  if (app) await app.end({timeout: 2});
  try {
    await eventually(async () => {
      const [{active}] = await admin`
        SELECT COALESCE(bool_or(active), false) AS active
        FROM pg_replication_slots
        WHERE database = ${database}
      `;
      return active === false;
    }, 10_000);
    const slots = await admin`
      SELECT slot_name
      FROM pg_replication_slots
      WHERE database = ${database}
    `;
    for (const {slot_name: slotName} of slots) {
      await admin`SELECT pg_drop_replication_slot(${slotName})`;
    }
    await admin.unsafe(`DROP DATABASE IF EXISTS ${database}`);
  } finally {
    await admin.end({timeout: 2});
  }
  for (const suffix of ['', '-shm', '-wal', '-wal2']) {
    await rm(`${replica}${suffix}`, {force: true});
  }
  if (ownsPostgres) {
    execFileSync(process.execPath, [pgScript, 'stop'], {cwd: root, stdio: 'ignore'});
  }
}
