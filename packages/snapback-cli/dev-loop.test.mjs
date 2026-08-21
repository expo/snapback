// Acceptance for the LLP 0079 SC-2b dev-loop client arm: one `snapback dev
// --client` process runs the managed backend watch loop AND a real Vite dev
// server carrying the SC-2a `@expo/snapback-vite` plugin in `auto` mode, on
// ephemeral ports with a temp database + ready file. The machine-readable
// stdin channel exercises the full verb slice — status, force
// regenerate-and-reload, restart backend — while edits to `functions.mjs`
// stay observable through the client surface's `/__snapback` relay without
// restarting either process.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldApp } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

const ADA = 'user_ada';
const auth = (userId) => ({ principal: userId, session_id: null, user_id: userId, permissions: [] });

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function eventually(check, { timeoutMs = 20_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

// Collects the snapback.dev.v1 JSON-line event stream from the dev process
// stdout. `mark()` + `waitFor(..., { from })` scope each wait to events that
// arrive after the action that should cause them.
class EventStream {
  constructor(child) {
    this.events = [];
    this.stderr = '';
    this.buffer = '';
    child.stderr.on('data', (chunk) => { this.stderr += chunk; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline;
      while ((newline = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim().startsWith('{')) continue;
        try {
          this.events.push(JSON.parse(line));
        } catch {
          // Not an event line; ignore.
        }
      }
    });
  }

  mark() {
    return this.events.length;
  }

  async waitFor(predicate, { from = 0, timeoutMs = 60_000, label = 'event' } = {}) {
    const deadline = Date.now() + timeoutMs;
    let cursor = from;
    while (Date.now() < deadline) {
      while (cursor < this.events.length) {
        const event = this.events[cursor];
        cursor += 1;
        if (predicate(event)) return event;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`timed out waiting for ${label}; saw ${this.events.length} events; `
      + `tail: ${JSON.stringify(this.events.slice(-8))}; stderr tail: ${this.stderr.slice(-2_000)}`);
  }
}

// realpath: the server canonicalizes the database path in the descriptor, so
// a symlinked macOS tmpdir would otherwise trip target validation.
const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-loop-')));
let dev = null;
let clientPid = null;
const readyFile = join(root, 'todo-contract', '.snapback', 'dev.ready.json');
try {
  const project = join(root, 'todo-contract');
  assert.equal(scaffoldApp(project).ok, true);
  const backend = join(project, 'snapback');
  const functionsPath = join(backend, 'functions.mjs');
  const functionsAsc = readFileSync(functionsPath, 'utf8');
  const functionsDesc = functionsAsc.replace('asc,', 'desc,').replace("asc('_createdAt')", "desc('_createdAt')");
  const functionsRuntimeTypo = functionsAsc
    .replace('  defineLiveQuery,', '  defineJsMutation,\n  defineLiveQuery,')
    .concat(`

export const runtimeTypo = defineJsMutation({
  args: {},
  writes: ['todos'],
  handler: async (ctx) => ctx.runtime.newId(),
});
`);
  assert.notEqual(functionsDesc, functionsAsc, 'template edit fixture must actually change the query order');
  assert.notEqual(functionsRuntimeTypo, functionsAsc, 'runtime typo fixture must add an inline handler');
  const database = join(project, '.snapback', 'dev.sqlite3');

  // The client arm is the REAL SC-2a plugin over a minimal Vite app run by
  // node (the vite package's own test proves node-run Vite works); it shares
  // the CLI's ready file + database, so `auto` mode attaches to the
  // CLI-managed server instead of spawning one.
  const clientDir = join(root, 'client');
  mkdirSync(join(clientDir, 'node_modules', '@expo'), { recursive: true });
  symlinkSync(join(repoRoot, 'packages', 'snapback-vite', 'node_modules', 'vite'), join(clientDir, 'node_modules', 'vite'));
  symlinkSync(join(repoRoot, 'packages', 'snapback-vite'), join(clientDir, 'node_modules', '@expo', 'snapback-vite'));
  writeFileSync(join(clientDir, 'index.html'), '<!doctype html><title>dev-loop client</title>\n');
  const clientPort = await freePort();
  writeFileSync(join(clientDir, 'client.mjs'), `
import { createServer } from 'vite';
import { snapbackDev } from '@expo/snapback-vite';

const server = await createServer({
  root: ${JSON.stringify(clientDir)},
  configFile: false,
  logLevel: 'silent',
  plugins: [snapbackDev({
    projectRoot: ${JSON.stringify(project)},
    server: {
      mode: 'auto',
      db: ${JSON.stringify(database)},
      readyFile: ${JSON.stringify(readyFile)},
      runtimeBinary: ${JSON.stringify(runtimeBinary)},
      stdio: 'ignore',
    },
    logJson: true,
  })],
  server: { host: '127.0.0.1', port: ${clientPort}, strictPort: true },
});
await server.listen();
console.log(JSON.stringify({ event: 'client-listening', origin: 'http://127.0.0.1:${clientPort}' }));
`);
  const clientOrigin = `http://127.0.0.1:${clientPort}`;
  const relay = `${clientOrigin}/__snapback`;

  dev = spawn(process.execPath, [
    join(packageDir, 'cli.mjs'),
    'dev', 'snapback',
    '--ready-file', readyFile,
    '--db', database,
    '--client', clientDir,
    '--client-command', `${JSON.stringify(process.execPath)} client.mjs`,
  ], {
    cwd: project,
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stream = new EventStream(dev);
  const send = (command) => dev.stdin.write(`${JSON.stringify(command)}\n`);
  const writeAndForceReload = async (contents, { requestId, label }) => {
    const from = stream.mark();
    writeFileSync(functionsPath, contents);
    send({ schemaVersion: 'snapback.dev-command.v1', verb: 'reload', requestId });
    const result = await stream.waitFor(
      (event) => event.requestId === requestId
        && ['generated-and-loaded', 'generated-but-not-loaded', 'generation-failed'].includes(event.state),
      { from, label },
    );
    assert.equal(result.state, 'generated-and-loaded', `${label}: ${JSON.stringify(result)}`);
    assert.equal(result.changed, '(reload)');
    return result;
  };

  // Order: managed server + first generate/load complete before the client
  // arm spawns, and stdin-not-a-TTY selects the machine-readable channel.
  const loaded = await stream.waitFor(
    (event) => event.state === 'generated-and-loaded',
    { timeoutMs: 120_000, label: 'initial generated-and-loaded' },
  );
  assert.equal(loaded.managed, true);
  const started = await stream.waitFor((event) => event.state === 'client-started', { label: 'client-started' });
  assert.ok(Number.isInteger(started.pid));
  clientPid = started.pid;
  const control = await stream.waitFor((event) => event.state === 'control-ready', { label: 'control-ready' });
  assert.equal(control.channel, 'json');
  assert.deepEqual(control.verbs, ['status', 'reload', 'restart', 'dev-fresh']);

  await eventually(async () => (await fetch(`${relay}/health`)).ok, {
    timeoutMs: 60_000,
    label: 'client relay serving /__snapback/health',
  });
  console.log('one command: managed backend loaded, SC-2a client arm attached and relaying');

  // --- status verb (machine-readable) ----------------------------------------
  let mark = stream.mark();
  send({ schemaVersion: 'snapback.dev-command.v1', verb: 'status', requestId: 'st-1' });
  const status1 = await stream.waitFor(
    (event) => event.state === 'status' && event.requestId === 'st-1',
    { from: mark, label: 'status st-1' },
  );
  assert.equal(status1.server.managed, true);
  assert.ok(Number.isInteger(status1.server.pid));
  assert.match(status1.server.serverUrl, /^http:\/\//);
  assert.equal(status1.server.running, true);
  assert.equal(status1.lastLoad.state, 'generated-and-loaded');
  assert.equal(status1.client.running, true);
  assert.equal(status1.client.pid, clientPid);
  const serverUrl = status1.server.serverUrl;
  console.log('status verb reports server, last-load, and client-arm facts');

  // --- app data through the client surface -----------------------------------
  const mutate = async (title) => {
    const response = await fetch(`${relay}/mutation/createTodo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: { title }, auth: auth(ADA), read_set: [] }),
    });
    assert.equal(response.ok, true, `createTodo ${title}: HTTP ${response.status}`);
    return response.json();
  };
  const listTitles = async () => {
    const response = await fetch(`${relay}/query/listTodos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ args: {}, auth: auth(ADA), read_set: [] }),
    });
    assert.equal(response.ok, true, `listTodos: HTTP ${response.status}`);
    const body = await response.json();
    return body.rows.map((row) => row.title);
  };
  await mutate('first todo');
  await mutate('second todo');
  assert.deepEqual(await listTitles(), ['first todo', 'second todo']);

  // --- managed-dev handler failures carry bounded underlying detail ---------
  // Use the request-correlated reload acknowledgment here instead of relying
  // on the watcher's debounced callback under machine load. The automatic
  // watcher remains covered by the live-edit and failure/recovery waves below.
  await writeAndForceReload(functionsRuntimeTypo, {
    requestId: 'runtime-typo-load',
    label: 'runtime typo handler load',
  });
  const runtimeTypoResponse = await fetch(`${relay}/mutation/runtimeTypo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: {}, auth: auth(ADA), read_set: [] }),
  });
  assert.equal(runtimeTypoResponse.status, 400);
  const runtimeTypo = await runtimeTypoResponse.json();
  assert.equal(runtimeTypo.diagnostic.code, 'SNAPBACK_HANDLER_FAILED');
  assert.match(runtimeTypo.diagnostic.message, /newId/u);
  assert.equal(runtimeTypo.diagnostic.details.property, 'newId');
  assert.equal(runtimeTypo.diagnostic.details.callee, 'ctx.runtime.newId');
  assert(Number.isInteger(runtimeTypo.diagnostic.details.sourcePosition?.line));
  assert(Number.isInteger(runtimeTypo.diagnostic.details.sourcePosition?.column));
  await writeAndForceReload(functionsAsc, {
    requestId: 'runtime-typo-remove',
    label: 'runtime typo handler removal',
  });
  const removedRuntimeTypoResponse = await fetch(`${relay}/mutation/runtimeTypo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: {}, auth: auth(ADA), read_set: [] }),
  });
  assert.equal(removedRuntimeTypoResponse.status, 404);
  const removedRuntimeTypo = await removedRuntimeTypoResponse.json();
  assert.equal(removedRuntimeTypo.diagnostic.code, 'SNAPBACK_UNKNOWN_FUNCTION');
  console.log('managed dev surfaces missing ctx member, TypeError detail, and handler position');

  // --- live edit observable through the client surface -----------------------
  mark = stream.mark();
  writeFileSync(functionsPath, functionsDesc);
  await stream.waitFor(
    (event) => event.state === 'generated-and-loaded' && /functions\.mjs$/.test(event.changed ?? ''),
    { from: mark, label: 'hot reload after functions.mjs edit' },
  );
  assert.deepEqual(await listTitles(), ['second todo', 'first todo']);
  console.log('functions.mjs edit observable through the relay without restarting either process');

  // --- generation failure surfaces machine-readably and recovers -------------
  mark = stream.mark();
  writeFileSync(functionsPath, `${functionsAsc}\nthis is not javascript((\n`);
  const failed = await stream.waitFor(
    (event) => event.state === 'generation-failed',
    { from: mark, label: 'generation-failed after bad edit' },
  );
  assert.equal(failed.ok, false);
  // The previously loaded artifacts keep serving.
  assert.deepEqual(await listTitles(), ['second todo', 'first todo']);
  mark = stream.mark();
  writeFileSync(functionsPath, functionsAsc);
  await stream.waitFor(
    (event) => event.state === 'generated-and-loaded' && /functions\.mjs$/.test(event.changed ?? ''),
    { from: mark, label: 'recovery after restoring functions.mjs' },
  );
  assert.deepEqual(await listTitles(), ['first todo', 'second todo']);
  console.log('generation-failed surfaced machine-readably; loop recovered');

  // --- reload verb: force regenerate-and-reload ------------------------------
  mark = stream.mark();
  send({ schemaVersion: 'snapback.dev-command.v1', verb: 'reload', requestId: 'rl-1' });
  const reloaded = await stream.waitFor(
    (event) => event.requestId === 'rl-1' && event.state === 'generated-and-loaded',
    { from: mark, label: 'forced reload rl-1' },
  );
  assert.equal(reloaded.changed, '(reload)');
  console.log('reload verb forces regenerate + hot push');

  // --- restart verb: backend restarts, client relay keeps working ------------
  mark = stream.mark();
  send({ schemaVersion: 'snapback.dev-command.v1', verb: 'restart', requestId: 'rs-1' });
  const restarted = await stream.waitFor(
    (event) => event.state === 'server-restarted' && event.requestId === 'rs-1',
    { from: mark, timeoutMs: 90_000, label: 'server-restarted rs-1' },
  );
  assert.equal(restarted.previousPid, status1.server.pid);
  assert.ok(Number.isInteger(restarted.pid));
  assert.notEqual(restarted.pid, restarted.previousPid);
  await stream.waitFor(
    (event) => event.requestId === 'rs-1' && event.state === 'generated-and-loaded' && event.changed === '(restart)',
    { from: mark, label: 'post-restart load rs-1' },
  );
  mark = stream.mark();
  send({ schemaVersion: 'snapback.dev-command.v1', verb: 'status', requestId: 'st-2' });
  const status2 = await stream.waitFor(
    (event) => event.state === 'status' && event.requestId === 'st-2',
    { from: mark, label: 'status st-2' },
  );
  assert.equal(status2.server.pid, restarted.pid);
  assert.equal(status2.client.running, true, 'restart must not restart the client process');
  assert.equal(status2.client.pid, clientPid);
  // The relay re-resolves its backend target from the rewritten ready file:
  // data survived (same database) and new writes work, through the SAME
  // running Vite process.
  await eventually(async () => {
    assert.deepEqual(await listTitles(), ['first todo', 'second todo']);
    return true;
  }, { timeoutMs: 30_000, label: 'relay serving queries after backend restart' });
  await mutate('third todo');
  assert.deepEqual(await listTitles(), ['first todo', 'second todo', 'third todo']);
  console.log('restart verb: new backend pid, same client process, relay re-resolved and serving');

  // --- structured command errors ---------------------------------------------
  mark = stream.mark();
  send({ schemaVersion: 'snapback.dev-command.v1', verb: 'dance', requestId: 'uv-1' });
  const unknownVerb = await stream.waitFor(
    (event) => event.state === 'command-error' && event.requestId === 'uv-1',
    { from: mark, label: 'unknown-verb command-error' },
  );
  assert.equal(unknownVerb.diagnostics[0].code, 'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB');
  assert.deepEqual(
    unknownVerb.diagnostics[0].details.supported,
    ['status', 'reload', 'restart', 'dev-fresh'],
  );
  mark = stream.mark();
  dev.stdin.write('this is not json\n');
  const badJson = await stream.waitFor(
    (event) => event.state === 'command-error',
    { from: mark, label: 'malformed-command command-error' },
  );
  assert.equal(badJson.diagnostics[0].code, 'SNAPBACK_DEV_COMMAND_INVALID');
  console.log('unknown verbs and malformed commands produce structured errors, not a crash');

  // Closed stdin is ordinary for detached agents and generated package scripts:
  // it closes the optional command channel without silently stopping dev.
  dev.stdin.end();
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  assert.equal(dev.exitCode, null, 'snapback dev must remain live after non-TTY stdin EOF');
  const healthAfterEof = await fetch(`${serverUrl}/health`).then((response) => response.json());
  assert.equal(healthAfterEof.ok, true, 'managed backend must remain healthy after stdin EOF');
  console.log('stdin EOF closes only the control channel; dev and both managed arms remain live');

  // --- clean signal shutdown tears down both arms ----------------------------
  dev.kill('SIGTERM');
  const exitCode = await new Promise((resolveExit) => dev.once('exit', resolveExit));
  assert.equal(exitCode, 0, `snapback dev must exit cleanly; stderr tail: ${stream.stderr.slice(-2_000)}`);
  dev = null;
  await eventually(async () => {
    try {
      await fetch(`${serverUrl}/health`);
      return false;
    } catch {
      return true;
    }
  }, { label: 'managed backend teardown' });
  await eventually(async () => {
    try {
      await fetch(`${relay}/health`);
      return false;
    } catch {
      return true;
    }
  }, { label: 'client arm teardown' });
  await eventually(() => !existsSync(readyFile), { label: 'ready-file cleanup' });
  console.log('dev-loop.test.mjs: client arm, verb slice (status/reload/restart), live edits, and clean shutdown pass');
} finally {
  if (dev && dev.exitCode === null) dev.kill('SIGKILL');
  if (clientPid !== null) {
    // The client arm runs in its own process group; make sure no Vite tree
    // survives a failed run.
    try {
      process.kill(-clientPid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  // Never leave a native server holding the temp database (the stale-server
  // trap): stop it via the nonce-verified native path if it survived.
  if (existsSync(readyFile)) {
    const { native } = await import('./index.mjs');
    native(runtimeBinary, ['stop', '--ready-file', readyFile], { env: process.env });
  }
  rmSync(root, { recursive: true, force: true });
}
