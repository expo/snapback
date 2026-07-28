// Ordinary one-command sessions startup witness. This deliberately does not
// pass the comparator-only bootstrapGeneratedAtStart option: runDev must infer
// the closed startup carrier from the generated schema itself.

import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDev, scaffoldApp } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-sessions-dev-loop-')));
const projectRoot = join(scratchRoot, 'react-sessions');
assert.equal(scaffoldApp(projectRoot, { template: 'react' }).ok, true);
const backendRoot = join(projectRoot, 'snapback');
const schemaPath = join(backendRoot, 'schema.mjs');
const devSchema = readFileSync(schemaPath, 'utf8');
const sessionsSchema = devSchema.replace(
  /\n\}\);\s*$/u,
  "\n}, { auth: { mode: 'sessions' } });\n",
);
assert.notEqual(sessionsSchema, devSchema);
writeFileSync(schemaPath, sessionsSchema);
const stateRoot = join(projectRoot, '.snapback');
const readyFile = join(stateRoot, 'dev.ready.json');
const database = join(stateRoot, 'dev.sqlite3');
const startupArtifacts = join(stateRoot, 'startup-artifacts.json');
const failNextStart = join(scratchRoot, 'fail-next-start');
const runtimeWrapper = join(scratchRoot, 'snapback-runtime-wrapper');
writeFileSync(runtimeWrapper, `#!/bin/sh
if [ "$1" = "start" ] && [ -f ${JSON.stringify(failNextStart)} ]; then
  echo "SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH: startup artifact carrier rejected by stale runtime" >&2
  exit 1
fi
exec ${JSON.stringify(runtimeBinary)} "$@"
`);
chmodSync(runtimeWrapper, 0o755);
const events = [];
let dev = null;

try {
  dev = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary: runtimeWrapper,
    watch: true,
    serverStdio: ['ignore', 'ignore', 'ignore'],
    onEvent(event) {
      events.push(event);
    },
  });

  assert.equal(dev.ok, true);
  assert.equal(dev.managed, true);
  assert.equal(dev.state, 'generated-and-loaded');
  assert(
    events.some((event) => event.state === 'generated-and-loaded' && event.managed === true),
    'ordinary runDev must publish its successful managed lifecycle event',
  );

  const carrier = JSON.parse(readFileSync(startupArtifacts, 'utf8'));
  assert.equal(carrier.formatVersion, 1);
  assert.equal(carrier.schema.auth.mode, 'sessions');
  assert.equal(carrier.functions.appId, carrier.schema.appId);
  assert.equal(
    Object.hasOwn(carrier, 'seed'),
    false,
    'LLP 0109 forbids passing a versioned artifact through the legacy startup seed member',
  );

  const sessionResponse = await fetch(`${dev.serverUrl}/auth/session`, {
    headers: { 'x-snapback-auth-client-protocol': '1' },
  });
  assert.equal(sessionResponse.ok, true);
  const session = await sessionResponse.json();
  assert.equal(session.activeMode, 'sessions');
  assert.equal(session.modeState, 'settled');
  assert.equal(session.appDataAvailability, 'available');

  const restarted = await dev.verbs.restart({ requestId: 'sessions-restart' });
  assert.equal(restarted.state, 'generated-and-loaded');
  assert.equal(restarted.requestId, 'sessions-restart');
  assert(
    events.some(
      (event) => event.state === 'server-restarted'
        && event.requestId === 'sessions-restart',
    ),
    'sessions restart must reuse a freshly resolved startup carrier',
  );
  const successorSession = await (
    await fetch(`${dev.serverUrl}/auth/session`, {
      headers: { 'x-snapback-auth-client-protocol': '1' },
    })
  ).json();
  assert.equal(successorSession.activeMode, 'sessions');
  assert.equal(successorSession.modeState, 'settled');

  writeFileSync(failNextStart, 'fail the next managed sessions restart\n');
  const failedRestart = await dev.verbs.restart({
    requestId: 'sessions-artifact-mismatch',
  });
  assert.equal(failedRestart.state, 'restart-failed');
  assert.equal(failedRestart.requestId, 'sessions-artifact-mismatch');
  assert.equal(
    failedRestart.diagnostics[0].code,
    'SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH',
  );
  assert.equal(
    failedRestart.diagnostics[0].details.selectedBinary,
    runtimeWrapper,
  );
  assert.match(
    failedRestart.diagnostics[0].details.recovery.compatibleOverride,
    /SNAPBACK_RUNTIME_BINARY/u,
  );
  assert.doesNotMatch(
    failedRestart.diagnostics[0].message,
    /refined is not defined|ReferenceError/u,
  );

  console.log('sessions-dev-loop.test.mjs: ordinary sessions startup/restart and deliberate stale-runtime restart diagnostics pass');
} finally {
  dev?.close?.();
  rmSync(scratchRoot, { recursive: true, force: true });
}
