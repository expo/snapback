import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  __test,
  createDiagnosticsChannel,
  createSnapbackViteLifecycle,
} from './lifecycle.mjs';

const roots = [];

function listen(server) {
  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen(server.address().port));
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(resolveClose));
}

function fixture(port) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'snapback-vite-stale-descriptor-'));
  roots.push(projectRoot);
  const backend = join(projectRoot, 'snapback');
  const generated = join(backend, 'generated');
  const state = join(projectRoot, '.snapback');
  mkdirSync(generated, { recursive: true });
  mkdirSync(state, { recursive: true });
  const database = join(state, 'dev.sqlite3');
  const readyFile = join(state, 'dev.ready.json');
  writeFileSync(readyFile, `${JSON.stringify({
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    ready: true,
    pid: process.pid,
    serverUrl: `http://127.0.0.1:${port}`,
    startupNonce: 'stale-descriptor-test',
    database: { mode: 'file', path: database },
  })}\n`, { mode: 0o600 });
  return { projectRoot, backend, database, readyFile };
}

function lifecycle(files, events) {
  return createSnapbackViteLifecycle({
    mode: 'auto',
    projectRoot: files.projectRoot,
    database: files.database,
    readyFile: files.readyFile,
    setup: { backendDirectory: files.backend, reset: 'never' },
    onEvent: (event) => events.push(event),
    logJson: false,
  });
}

try {
  const deadProbe = createServer();
  const deadPort = await listen(deadProbe);
  await close(deadProbe);
  const deadFiles = fixture(deadPort);
  const deadEvents = [];
  const deadLifecycle = lifecycle(deadFiles, deadEvents);
  await assert.rejects(
    () => deadLifecycle.start(),
    (error) => error.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR'
      && error.diagnostic.details.readyFile === deadFiles.readyFile
      && error.diagnostic.details.remediation.includes('rerun snapback dev without --attach'),
  );
  assert.ok(deadEvents.some((event) => (
    event.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_DESCRIPTOR'
    && event.message.includes('at probe time')
  )));
  await deadLifecycle.close();

  const foreign = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const occupiedPort = await listen(foreign);
  const occupiedFiles = fixture(occupiedPort);
  const occupiedEvents = [];
  const occupiedLifecycle = lifecycle(occupiedFiles, occupiedEvents);
  await assert.rejects(
    () => occupiedLifecycle.start(),
    (error) => error.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER'
      && error.diagnostic.details.port === occupiedPort,
  );
  assert.ok(occupiedEvents.some((event) => (
    event.code === 'SNAPBACK_DEV_FIXED_PORT_STALE_LISTENER'
    && event.message.includes('occupied port')
  )));
  await occupiedLifecycle.close();
  await close(foreign);

  for (const probeError of ['ETIMEDOUT', 'EACCES']) {
    const readyFile = `/preserved/${probeError}.ready.json`;
    const attachError = Object.assign(new Error('indeterminate port probe'), {
      code: 'SNAPBACK_DEV_SERVER_ATTACH_FAILED',
      diagnostic: {
        details: { probeState: 'indeterminate', probeError },
      },
    });
    const event = __test.autoAttachFailureEvent(attachError, readyFile);
    const reEmitted = [];
    createDiagnosticsChannel({
      onEvent: (payload) => reEmitted.push(payload),
      logJson: false,
    }).emit(event);
    assert.equal(reEmitted.length, 1);
    assert.equal(reEmitted[0].code, 'SNAPBACK_DEV_SERVER_ATTACH_FAILED');
    assert.equal(reEmitted[0].probeError, probeError);
    assert.equal(reEmitted[0].readyFile, readyFile);
    assert.match(reEmitted[0].message, new RegExp(probeError));
    assert.match(reEmitted[0].message, /descriptor was preserved/u);
  }

  console.log('stale-descriptor.test.mjs: 4 Vite auto re-emits passed (refused descriptor, occupied listener, timeout, other socket error)');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
