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

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { generateApp, runDev, scaffoldApp } from './index.mjs';

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

  // issues/20260729-sessions-client-inspect-omits-protocol-offer: the official
  // public inspection method negotiates the active sessions profile without
  // hand-authored headers, while sensitive operator inspection remains
  // separately authorized behind the exact secret-read lease — and the two
  // refusals carry distinct typed diagnostics.
  {
    const coordinator = new AuthCoordinator({
      appId: carrier.schema.appId,
      storage: createMemoryAuthCustodyStorage({ state: {} }),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    const sessionsClient = new SnapbackClient(dev.serverUrl, {
      authCoordinator: coordinator,
      adminToken: null,
      clientStoreId: 'sessions-dev-loop-inspect',
    });
    try {
      const publicProjection = await sessionsClient.inspect();
      assert.equal(publicProjection.schema.appId, carrier.schema.appId);
      assert.equal(publicProjection.artifactKind, 'runtimeState');
      assert.equal(
        publicProjection.storage.sqlitePath,
        undefined,
        'the public projection must stay trimmed: no operational storage path',
      );

      // The same request without the negotiated offer refuses with the typed
      // missing-offer diagnostic, value-free.
      const offerless = await fetch(`${dev.serverUrl}/inspect`);
      assert.equal(offerless.status, 400);
      const offerlessText = await offerless.text();
      const offerlessBody = JSON.parse(offerlessText);
      assert.equal(
        offerlessBody.diagnostic.code,
        'SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED',
      );
      assert.match(
        offerlessBody.diagnostic.message,
        /x-snapback-auth-client-protocol: 1/u,
        'the missing-offer refusal names its repair',
      );
      assert.doesNotMatch(
        offerlessText,
        new RegExp(carrier.schema.appId.replace(/[/\\^$*+?.()|[\]{}]/gu, '\\$&'), 'u'),
        'the missing-offer refusal is value-free',
      );

      // Sensitive operator inspection is never silently substituted: the same
      // negotiated client identity cannot read it without the exact
      // secret-read lease, and the refusal is a distinct typed diagnostic.
      const operator = await fetch(`${dev.serverUrl}/_snapback/api/inspect`, {
        headers: { 'x-snapback-auth-client-protocol': '1' },
      });
      assert.equal(operator.status, 401);
      const operatorText = await operator.text();
      const operatorBody = JSON.parse(operatorText);
      assert.equal(
        operatorBody.diagnostic.code,
        'SNAPBACK_ADMIN_SECRET_READ_REQUIRED',
      );
      assert.notEqual(operatorBody.diagnostic.code, offerlessBody.diagnostic.code);
      assert.doesNotMatch(
        operatorText,
        /sqlite|appId|schemaHash/u,
        'the missing-lease refusal is value-free',
      );
    } finally {
      await sessionsClient.closeAuth?.();
      await coordinator.close();
    }
  }

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

  // issues/20260801-0137-a3-restart-evolution-refusal-misattributed-diagnostic:
  // stop/regenerate/restart over the same sessions database is refused by the
  // auth-mode startup pin. That refusal must surface as itself, carrying the
  // expected deployment identity and the sanctioned evolution path — never as
  // a runtime/codegen identity mismatch with reinstall advice.
  rmSync(failNextStart, { force: true });
  const evolvedSchema = sessionsSchema.replace(
    ".index('by_title', ['title'])",
    ".index('by_title', ['title']).index('by_completed', ['completed'])",
  );
  assert.notEqual(evolvedSchema, sessionsSchema);
  writeFileSync(schemaPath, evolvedSchema);
  const regenerated = await generateApp(backendRoot);
  assert.equal(regenerated.ok, true);
  const pinRefused = await dev.verbs.restart({ requestId: 'sessions-startup-pin' });
  assert.equal(pinRefused.state, 'restart-failed');
  assert.equal(pinRefused.requestId, 'sessions-startup-pin');
  const pinDiagnostic = pinRefused.diagnostics[0];
  assert.equal(
    pinDiagnostic.code,
    'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH',
    `the startup pin must name itself, got: ${JSON.stringify(pinDiagnostic)}`,
  );
  assert.equal(pinDiagnostic.details.causeCode, 'SNAPBACK_DEV_SERVER_START_FAILED');
  assert.match(
    pinDiagnostic.details.recovery.sanctionedEvolution,
    /running dev server|reload/iu,
    'the recovery names the supported evolution path',
  );
  // issues/20260805-doc-comment-artifact-mismatch-no-successor-migration.md:
  // the discard path must be a named supported procedure with the real backup
  // command and this exact store, not author-discovered folklore.
  assert.match(
    pinDiagnostic.details.recovery.freshReseed,
    /snapback auth backup --db /u,
    'the recovery names the supported backup-then-reseed discard path',
  );
  assert.ok(
    pinDiagnostic.details.recovery.freshReseed.includes(database),
    'the reseed guidance names the exact managed store',
  );
  assert.equal(
    pinDiagnostic.details.recovery.contributorRebuild,
    undefined,
    'the pin refusal must not carry the runtime-identity rebuild advice',
  );
  assert.equal(
    pinDiagnostic.details.recovery.compatibleOverride,
    undefined,
    'the pin refusal must not advise a SNAPBACK_RUNTIME_BINARY override',
  );
  assert.ok(
    pinDiagnostic.details.expectedDeployment?.schemaHash,
    'the structured refusal carries the exact expected deployment identity',
  );
  assert.ok(
    pinDiagnostic.details.observedDeployment?.schemaHash,
    'the structured refusal carries the observed (regenerated) identity',
  );
  assert.notEqual(
    pinDiagnostic.details.observedDeployment.schemaHash,
    pinDiagnostic.details.expectedDeployment.schemaHash,
  );

  console.log('sessions-dev-loop.test.mjs: ordinary sessions startup/restart, deliberate stale-runtime restart, and startup-pin refusal diagnostics pass');
} finally {
  dev?.close?.();
  rmSync(scratchRoot, { recursive: true, force: true });
}
