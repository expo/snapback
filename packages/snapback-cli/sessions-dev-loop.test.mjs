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
import { webcrypto } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSnapbackAppClient, SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import { IDBFactory } from 'fake-indexeddb';

import {
  generateApp,
  readApplicationReadyReceipt,
  runDev,
  scaffoldApp,
} from './index.mjs';

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
const sessionsSchema = /auth:\s*\{\s*mode:\s*['"]sessions['"]/u.test(devSchema)
  ? devSchema
  : devSchema.replace(
      /\n\}\);\s*$/u,
      "\n}, { auth: { mode: 'sessions' } });\n",
    );
assert.match(sessionsSchema, /auth:\s*\{\s*mode:\s*['"]sessions['"]/u);
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
let continuityClient = null;
const sleep = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const waitFor = async (predicate, label, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
};

try {
  dev = await runDev({
    backendDirectory: backendRoot,
    projectRoot,
    readyFile,
    database,
    runtimeBinary: runtimeWrapper,
    qualifiedRuntimeBinary: runtimeBinary,
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

  // issues/closed/20260820-agent-auth-transition-residuals.md residual 2: this is
  // the real watch path (not a direct load and not packed HTTP retry). Keep an
  // authenticated stream mounted while a source edit drives generate +
  // same-mode activation. The resync sentinel must synchronously fence its
  // predecessor, surface retain-stale, and land one authoritative successor.
  {
    const generatedApiPath = join(backendRoot, 'generated', 'api.mjs');
    const watchApi = (await import(
      `${pathToFileURL(generatedApiPath).href}?watch=${Date.now()}`
    )).default;
    const storage = createMemoryAuthCustodyStorage({ state: { custody: {} } });
    const coordinator = new AuthCoordinator({
      appId: carrier.schema.appId,
      storage,
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    const watchClient = new SnapbackClient(dev.serverUrl, {
      authCoordinator: coordinator,
      clientStoreId: 'sessions-watch-reload-successor',
      rqsStore: null,
      offlineQueue: false,
    });
    let live = null;
    const connectionStates = [];
    const subscriptionEvents = [];
    const updates = [];
    try {
      const password = 'sessions-watch-reload-password-123!';
      await watchClient.authPasswordSignup({
        email: `sessions-watch-${process.pid}@example.com`,
        password,
      });
      const watchTitle = `Watch successor row ${process.pid}`;
      await watchClient.mutate(watchApi.createTodo, {
        args: { title: watchTitle },
        queue: false,
      });
      live = await watchClient.liveQuery('listTodos', {
        connectionId: 'sessions-watch-reload-successor',
        transport: 'stream',
        fallbackToPoll: false,
        onConnectionChange(state) {
          connectionStates.push(state);
        },
        onSubscriptionEvent(event) {
          subscriptionEvents.push(event);
        },
        onUpdate(rows, detail) {
          updates.push({
            kind: detail.kind,
            rows: rows.map((row) => row.title),
            subscriptionId: live?.subscriptionId ?? null,
            connection: live?.connection ?? 'establishing',
            freshness: live?.freshness ?? null,
          });
        },
      });
      await waitFor(() => live.connection === 'live', 'predecessor stream readiness');
      assert(live.rows.some((row) => row.title === watchTitle));

      const predecessorSubscriptionId = live.subscriptionId;
      const eventCut = events.length;
      const subscriptionEventCut = subscriptionEvents.length;
      const updateCut = updates.length;
      const custodyBefore = storage.snapshot(carrier.schema.appId);
      assert.ok(custodyBefore, 'password signup installed durable client custody');

      // Start enough ordinary reads at the watch cut to exercise the finite
      // axisless mode-pending window. Every one must finish under the same
      // custody; no retry may turn a transient into terminal auth loss.
      const tightLoop = Promise.all(Array.from({ length: 64 }, () => (
        watchClient.query('listTodos')
      )));
      const functionsPath = join(backendRoot, 'functions.mjs');
      writeFileSync(
        functionsPath,
        `// Real live-stream watch-reload successor witness.\n${readFileSync(functionsPath, 'utf8')}`,
      );
      await waitFor(
        () => events.slice(eventCut).find((event) => (
          event.state === 'generated-and-loaded'
          && /functions\.mjs$/u.test(event.changed ?? '')
        )),
        'watched sessions successor activation',
      );
      await waitFor(
        () => live.subscriptionId !== predecessorSubscriptionId
          && live.connection === 'live'
          && live.freshness === 'current',
        'authoritative live successor after watch reload',
      );
      const tightLoopRows = await tightLoop;
      assert(
        tightLoopRows.every((result) => result.rows.some((row) => row.title === watchTitle)),
        'tight-loop reads all retained the authenticated product row',
      );
      assert.deepEqual(
        storage.snapshot(carrier.schema.appId),
        custodyBefore,
        'axisless watch retries do not clear, replace, or revise durable custody',
      );
      assert.equal(watchClient.authTerminalStatus().terminated, false);
      assert(
        connectionStates.slice(-3).includes('stale'),
        `watch reload never projected its bounded stale state: ${JSON.stringify(connectionStates)}`,
      );
      const successors = subscriptionEvents.slice(subscriptionEventCut)
        .filter(({ event }) => event === 'resubscribed');
      assert.equal(
        successors.length,
        1,
        `watch reload landed ${successors.length} live successors instead of one`,
      );
      const successorSnapshots = updates.slice(updateCut).filter(({ kind }) => kind === 'snapshot');
      assert.equal(
        successorSnapshots.length,
        1,
        `watch reload published ${successorSnapshots.length} authoritative successor snapshots instead of one`,
      );
      assert.equal(successorSnapshots[0].subscriptionId, live.subscriptionId);
      assert.equal(successorSnapshots[0].freshness, 'current');
      assert.equal(
        updates.slice(updateCut).some((update) => (
          update.subscriptionId === predecessorSubscriptionId
        )),
        false,
        'a fenced predecessor frame reached app code regardless of connection projection',
      );
    } finally {
      live?.dispose();
      await watchClient.closeAuth();
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

  const generatedApiPath = join(backendRoot, 'generated', 'api.mjs');
  const initialGenerated = await import(
    `${pathToFileURL(generatedApiPath).href}?initial=${Date.now()}`
  );
  const initialApi = initialGenerated.default;
  const preservedTitle = `Preserved successor row ${process.pid}`;

  // W1 fixed-lifecycle continuity: establish a real account/session in a
  // durable browser store, add one compatible table, and hot-regenerate. The
  // owner rewrites the startup carrier, the process/port stay fixed, and the
  // receipt/event report an old -> new deployment identity rather than
  // pretending identity equality.
  const continuityPlatform = Object.freeze({
    kind: 'browser',
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-sessions-successor-${process.pid}`,
  });
  continuityClient = await createSnapbackAppClient({
    app: initialGenerated.app,
    binding: readApplicationReadyReceipt(`${readyFile}.application-ready`).binding,
    platform: continuityPlatform,
  });
  const continuityEmail = `successor-${process.pid}@example.test`;
  await continuityClient.auth.signUpWithPassword({
    email: continuityEmail,
    password: 'successor-continuity-password',
  });
  const continuityUserId = continuityClient.auth.currentPrincipal().userId;
  assert.equal(continuityClient.auth.currentPrincipal().status, 'authenticated');
  await continuityClient.client.mutate(initialApi.createTodo, {
    args: { title: preservedTitle },
    queue: false,
  });
  assert(
    (await continuityClient.client.query(initialApi.listTodos)).rows.some(
      (row) => row.title === preservedTitle,
    ),
    'the predecessor account owns a product row before successor activation',
  );
  const additiveSchema = sessionsSchema.replace(
    '    todos: defineTable({',
    "    labels: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }).sync(),\n    todos: defineTable({",
  );
  assert.notEqual(additiveSchema, sessionsSchema);
  const backendPidBeforeAdditive = dev.child.pid;
  writeFileSync(schemaPath, additiveSchema);
  const additiveReload = await dev.verbs.reload({ requestId: 'sessions-additive-successor' });
  assert.equal(additiveReload.state, 'generated-and-loaded');
  assert.equal(dev.child.pid, backendPidBeforeAdditive, 'hot successor keeps the pinned server process');
  const additiveActivation = events.find(
    (event) => event.state === 'startup-successor-activated'
      && event.requestId === 'sessions-additive-successor',
  );
  assert.ok(additiveActivation, 'additive hot-load reports the deployment identity advance');
  assert.notEqual(
    additiveActivation.fromDeployment.schemaHash,
    additiveActivation.toDeployment.schemaHash,
  );
  assert.deepEqual(additiveActivation.continuity, {
    database: 'preserved',
    accounts: 'preserved',
    sessions: 'preserved',
    stores: 'preserved',
  });
  const additiveCarrier = JSON.parse(readFileSync(startupArtifacts, 'utf8'));
  assert.ok(
    additiveCarrier.schema.tables.some((table) => table.name === 'labels'),
    'regenerate rewrites the owner startup carrier',
  );
  assert.equal(continuityClient.auth.currentPrincipal().userId, continuityUserId);
  await continuityClient.dispose();
  continuityClient = null;
  const additiveGenerated = await import(
    `${pathToFileURL(generatedApiPath).href}?additive=${Date.now()}`
  );
  continuityClient = await createSnapbackAppClient({
    app: additiveGenerated.app,
    binding: readApplicationReadyReceipt(`${readyFile}.application-ready`).binding,
    platform: continuityPlatform,
  });
  assert.equal(continuityClient.auth.currentPrincipal().status, 'authenticated');
  assert.equal(continuityClient.auth.currentPrincipal().userId, continuityUserId);
  assert(
    (await continuityClient.client.query(additiveGenerated.default.listTodos)).rows.some(
      (row) => row.title === preservedTitle,
    ),
    'the original account session and product row survive additive regeneration',
  );

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

  // issues/closed/20260805-doc-comment-artifact-mismatch-no-successor-migration.md:
  // a source comment rotates the complete bundle identity without changing
  // schema. The managed loop observes the ordinary startup pin, explicitly
  // activates the complete successor, and preserves the local product row.
  rmSync(failNextStart, { force: true });
  const functionsPath = join(backendRoot, 'functions.mjs');
  const predecessorFunctions = readFileSync(functionsPath, 'utf8');
  const successorFunctions = `// Documentation-only successor identity rotation.\n${predecessorFunctions}`;
  writeFileSync(functionsPath, successorFunctions);
  const regenerated = await generateApp(backendRoot);
  assert.equal(regenerated.ok, true);
  const activatedRestart = await dev.verbs.restart({ requestId: 'sessions-startup-successor' });
  assert.equal(activatedRestart.state, 'generated-and-loaded');
  assert.equal(activatedRestart.requestId, 'sessions-startup-successor');
  const activation = events.find(
    (event) => event.state === 'startup-successor-activated'
      && event.requestId === 'sessions-startup-successor',
  );
  assert.ok(activation, 'the loop explicitly reports startup successor activation');
  assert.equal(
    activation.fromDeployment.schemaHash,
    activation.toDeployment.schemaHash,
    'a documentation-only function edit keeps the schema identity',
  );
  assert.notEqual(
    activation.fromDeployment.bundleHash,
    activation.toDeployment.bundleHash,
    'the documentation-only edit rotates the complete bundle identity',
  );
  assert.equal(activation.database, database);
  const successorApi = (await import(
    `${pathToFileURL(generatedApiPath).href}?successor=${Date.now()}`
  )).default;
  const successorClient = new SnapbackClient(dev.serverUrl, {
    custody: 'anonymous-public',
    rqsStore: null,
    offlineQueue: false,
  });
  assert(
    (await successorClient.query(successorApi.listTodos)).rows.some(
      (row) => row.title === preservedTitle,
    ),
    'the local product row survives the cold successor activation',
  );
  await successorClient.closeAuth();

  // A complete generated pair can still be an invalid schema successor. A
  // newly required field over an existing row must fail the guarded storage
  // cut, remain on the old deployment, and keep the row intact. The pair must
  // be complete — the functions half provides the new required field so
  // generation succeeds — because an incomplete pair is refused earlier, by
  // codegen, and never reaches the guarded cut.
  const invalidSchema = additiveSchema.replace(
    'completed: v.boolean(),',
    'completed: v.boolean(),\n    category: v.string(),',
  );
  assert.notEqual(invalidSchema, sessionsSchema);
  const invalidFunctions = successorFunctions.replace(
    'completed: lit(false),',
    "completed: lit(false),\n    category: lit('general'),",
  );
  assert.notEqual(invalidFunctions, successorFunctions);
  writeFileSync(schemaPath, invalidSchema);
  writeFileSync(functionsPath, invalidFunctions);
  assert.equal((await generateApp(backendRoot)).ok, true);
  const invalidRestart = await dev.verbs.restart({
    requestId: 'sessions-invalid-successor',
  });
  assert.equal(invalidRestart.state, 'restart-failed');
  assert.equal(
    invalidRestart.diagnostics[0].code,
    'SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH',
    `invalid successor must remain a startup-pin refusal: ${JSON.stringify(invalidRestart)}`,
  );
  assert.ok(
    invalidRestart.diagnostics[0].details.activationFailure,
    'the refusal retains the concrete activation failure',
  );
  assert.equal(
    events.some(
      (event) => event.state === 'startup-successor-activated'
        && event.requestId === 'sessions-invalid-successor',
    ),
    false,
    'an invalid successor is never reported as activated',
  );

  writeFileSync(schemaPath, additiveSchema);
  writeFileSync(functionsPath, successorFunctions);
  assert.equal((await generateApp(backendRoot)).ok, true);
  const recovered = await dev.verbs.restart({ requestId: 'sessions-invalid-recovery' });
  assert.equal(recovered.state, 'generated-and-loaded');
  const recoveredApi = (await import(
    `${pathToFileURL(generatedApiPath).href}?recovered=${Date.now()}`
  )).default;
  const recoveredClient = new SnapbackClient(dev.serverUrl, {
    custody: 'anonymous-public',
    rqsStore: null,
    offlineQueue: false,
  });
  assert(
    (await recoveredClient.query(recoveredApi.listTodos)).rows.some(
      (row) => row.title === preservedTitle,
    ),
    'the refused invalid successor leaves the local row available after recovery',
  );
  await recoveredClient.closeAuth();

  console.log('sessions-dev-loop.test.mjs: real live-stream watch successor, custody-preserving tight loop, sessions restart, explicit comment-successor activation with preserved rows, stale-runtime refusal, and invalid-successor refusal pass');
} finally {
  await continuityClient?.dispose?.();
  await dev?.close?.();
  rmSync(scratchRoot, { recursive: true, force: true });
}
