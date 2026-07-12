// ENG-24378: startup/shutdown is identified by the ready-file nonce and owns
// an isolated process tree. No real Snapback build is needed for this lifecycle
// suite; a tiny child speaks the same ready + /health identity handshake.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __startServerForTests } from '../server-process.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'server-process-lifecycle-'));
const fixture = join(scratch, 'fixture-server.cjs');
const EXPECTED = {
  crateVersion: '7.8.9-test',
  gitCommit: '0123456789abcdef0123456789abcdef01234567',
  gitDirty: false,
};

writeFileSync(fixture, String.raw`
const { randomUUID } = require('node:crypto');
const { writeFileSync, renameSync } = require('node:fs');
const { createServer } = require('node:http');
const readyFile = process.argv[2];
const expected = JSON.parse(process.env.FIXTURE_EXPECTED);
const nonce = randomUUID();
const server = createServer((req, res) => {
  if (req.url !== '/health') { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    ok: true,
    target: 'local-dev-sqlite-ibex',
    binary: { ...expected, buildProfile: 'debug', startupNonce: nonce },
  }));
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const tmp = readyFile + '.tmp';
  writeFileSync(tmp, JSON.stringify({
    ready: true,
    serverUrl: 'http://127.0.0.1:' + port,
    port,
    pid: process.pid,
    startupNonce: nonce,
  }));
  renameSync(tmp, readyFile);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
`);

const deps = {
  expectedIdentity: EXPECTED,
  preflight: () => ({}),
  launchSpec: ({ readyFile, cwd, env }) => ({
    command: process.execPath,
    args: [fixture, readyFile],
    cwd,
    env: { ...env, FIXTURE_EXPECTED: JSON.stringify(EXPECTED) },
  }),
};

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const previousToken = process.env.SNAPBACK_ADMIN_TOKEN;
delete process.env.SNAPBACK_ADMIN_TOKEN;
const running = [];

try {
  const first = await __startServerForTests({ port: 4399, cwd: scratch, startupTimeoutMs: 2_000 }, deps);
  running.push(first);
  assert.equal(first.reused, false);
  assert.match(first.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(Number(new URL(first.baseUrl).port), 4399, 'new child owns an OS-assigned port');
  assert.match(first.startupNonce, /^[0-9a-f-]+$/i);
  assert.equal(first.credentials.adminToken, first.adminToken);
  assert.equal(first.clientOptions.adminToken, first.adminToken);
  assert.equal(process.env.SNAPBACK_ADMIN_TOKEN, undefined, 'startup does not contaminate global credentials');

  const squatter = await listen((_req, res) => {
    res.statusCode = 503;
    res.end('not snapback');
  });
  const squatterPort = squatter.address().port;
  const isolated = await __startServerForTests({
    port: squatterPort,
    cwd: scratch,
    startupTimeoutMs: 2_000,
  }, deps);
  running.push(isolated);
  assert.notEqual(Number(new URL(isolated.baseUrl).port), squatterPort, 'unhealthy occupant is never adopted');
  await new Promise((resolve) => squatter.close(resolve));

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 1_000 }, {
      ...deps,
      launchSpec: () => ({ command: join(scratch, 'missing-executable'), args: [], cwd: scratch, env: {} }),
    }),
    /spawn failed/,
    'spawn errors reject instead of becoming unhandled child events',
  );

  await assert.rejects(
    __startServerForTests({ port: 0, cwd: scratch, startupTimeoutMs: 1_000 }, {
      ...deps,
      launchSpec: () => ({ command: process.execPath, args: ['-e', 'process.exit(17)'], cwd: scratch, env: process.env }),
    }),
    /exited before verified readiness \(17\)/,
    'immediate exit is reported before readiness',
  );

  // Same requested port, simultaneous helpers: every child asks the OS to
  // bind port zero and proves its own nonce, so probe-to-bind races disappear.
  const parallel = await Promise.all(Array.from({ length: 4 }, () =>
    __startServerForTests({ port: 4499, cwd: scratch, startupTimeoutMs: 2_000 }, deps)));
  running.push(...parallel);
  assert.equal(new Set(parallel.map((server) => server.baseUrl)).size, parallel.length);

  const stopping = running.splice(0).map((server) => server.stop());
  await Promise.all(stopping);
  console.log('server-process-lifecycle: PASS');
} finally {
  await Promise.allSettled(running.map((server) => server.stop()));
  if (previousToken === undefined) delete process.env.SNAPBACK_ADMIN_TOKEN;
  else process.env.SNAPBACK_ADMIN_TOKEN = previousToken;
  rmSync(scratch, { recursive: true, force: true });
}
