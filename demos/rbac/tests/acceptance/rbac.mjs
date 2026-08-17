import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asUser } from '../../../_kit/as-user.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';
import {
  closeAcceptanceSession,
  OwnedLiveSubscriptions,
  TerminalAcceptanceWatchdog,
} from './owned-live-subscriptions.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const generatedRoot = join(here, '..', '..', 'snapback', 'generated');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-rbac-demo-'));
const sessions = [];
const liveSubscriptions = new OwnedLiveSubscriptions();
let server = null;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const OPERATION_TIMEOUT_MS = 30_000;
const ACCEPTANCE_WATCHDOG_MS = 120_000;
const ACCEPTANCE_TERMINAL_GRACE_MS = 10_000;
const GOVERNANCE_REMOTE_CUSTODY_REFUSAL =
  'SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE';
let acceptanceWatchdog = null;
let serverStopPromise = null;
let primaryFailure = null;

const stopServer = () => {
  if (server === null) return Promise.resolve();
  serverStopPromise ??= server.stop();
  return serverStopPromise;
};

const namespaceFor = (clientStoreId, appId) => Object.freeze({
  clientStoreId,
  queryKey: `listAnnouncements:${JSON.stringify({ appId })}`,
  queryInstanceId: 1,
});

const decodeDurableFrames = (envelopes) => envelopes.flatMap((envelope) => {
  const payload = envelope?.Durable?.payload;
  if (payload === undefined) return [];
  const text = typeof payload === 'string'
    ? payload
    : new TextDecoder().decode(Uint8Array.from(payload ?? []));
  return [JSON.parse(text)];
});

const assertSubscriptionScope = (live, scope, label) => {
  assert.equal(scope?.kind, 'subscription', `${label} must target a subscription scope`);
  assert.deepEqual(scope?.namespace, live.authorizationNamespace, `${label} crossed query namespace`);
  assert.equal(scope?.subscriptionId, live.subscriptionId, `${label} crossed subscription identity`);
};

// @ref LLP 0234#d3--widening-requires-a-remotely-prior-artifact-closed-approval-receipt
// — the live server, not only the dev-mint helper, must consume target-owned
// custody and refuse before readiness when that carrier is unavailable.
async function assertMissingGovernanceTargetRefusesBoot({ binaryPath, startupArtifacts }) {
  assert.equal(typeof binaryPath, 'string', 'the exact selected server binary path must be retained');
  const readyFile = join(scratch, 'missing-governance-ready.json');
  const missingTargetConfig = join(scratch, 'missing-governance-target-config.json');
  await rm(readyFile, { force: true });
  await rm(missingTargetConfig, { force: true });

  const environment = {
    ...process.env,
    SNAPBACK_VISIBILITY_GOVERNANCE_TARGET_CONFIG: missingTargetConfig,
  };
  for (const key of [
    'SNAPBACK_SERVER_BINARY',
    'SNAPBACK_BUILD_GIT_COMMIT',
    'SNAPBACK_BUILD_GIT_DIRTY',
  ]) {
    delete environment[key];
  }

  const child = spawn(binaryPath, [
    'start',
    '--port',
    '0',
    '--ready-file',
    readyFile,
    '--memory',
    '--startup-artifacts',
    startupArtifacts,
  ], {
    cwd: repoRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, OPERATION_TIMEOUT_MS);
  let exit;
  try {
    exit = await new Promise((resolveExit, reject) => {
      let spawnError = null;
      child.once('error', (error) => { spawnError = error; });
      child.once('close', (code, signal) => {
        if (spawnError !== null) reject(spawnError);
        else resolveExit({ code, signal });
      });
    });
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(timedOut, false, `missing governance target boot did not settle:\n${output}`);
  assert.equal(exit.signal, null, `missing governance target boot was signaled:\n${output}`);
  assert.notEqual(exit.code, 0, 'missing governance target config unexpectedly booted');
  assert.match(output, new RegExp(GOVERNANCE_REMOTE_CUSTODY_REFUSAL, 'u'));
  await assert.rejects(
    readFile(readyFile, 'utf8'),
    (error) => error?.code === 'ENOENT',
    'governance refusal must happen before the child publishes readiness',
  );
  console.log(
    `REFUSED snapback child missing governance target config ${GOVERNANCE_REMOTE_CUSTODY_REFUSAL}`,
  );
}

async function applyAuthorizationProjection(live, projection, fallbackSnapshot = null) {
  const { obligation, resolution = null } = projection;
  assertSubscriptionScope(live, obligation?.scopeId, 'authorization obligation');
  if (resolution !== null) {
    assertSubscriptionScope(live, resolution.scopeId, 'authorization resolution');
    assert.equal(resolution.revision, obligation.revision);
  }
  if (['quarantine', 'delete'].includes(obligation.maxDisposition)) live.rows = [];
  const snapshot = projection.snapshot ?? fallbackSnapshot;
  if (snapshot !== null) {
    const subscriptionId = snapshot.subscriptionId ?? live.subscriptionId;
    assert.equal(subscriptionId, live.subscriptionId, 'authorization snapshot crossed subscription');
    assert.equal(snapshot.function ?? 'listAnnouncements', 'listAnnouncements');
    if (live.forbidVisibleRows && snapshot.rows.length > 0) {
      assert.fail(`isolated live owner received protected authorization rows: ${JSON.stringify(snapshot.rows)}`);
    }
    live.rows = structuredClone(snapshot.rows);
    live.version = snapshot.version;
  }
  live.authorizationInvalidations += 1;
  if (resolution !== null) {
    const acknowledged = await live.session.client.acknowledgeAuthorizationInvalidation(
      live.connectionId,
      resolution.ackToken,
    );
    // @ref LLP 0053#invalidation-is-an-obligation-not-a-message — a later
    // merged revision can legitimately make this frame's acknowledgement
    // stale. The level-triggered successor frame remains in the drain and must
    // provide the current snapshot before the bounded wait can succeed.
    assert(
      ['discharged', 'duplicate', 'stale'].includes(acknowledged.outcome),
      `authorization ACK returned an unknown outcome: ${JSON.stringify(acknowledged)}`,
    );
  }
}

async function applyLiveFrame(live, frame) {
  live.frames.push(structuredClone(frame));
  if (frame.kind === 'authorization_invalidation') {
    await applyAuthorizationProjection(live, frame);
    return;
  }
  if (frame.kind === 'live_replace') {
    assert.equal(frame.subscription_id, live.subscriptionId, 'live replace crossed subscription');
    assert.equal(frame.function, 'listAnnouncements');
    if (live.forbidVisibleRows && frame.rows.length > 0) {
      assert.fail(`isolated live owner received a protected replace: ${JSON.stringify(frame)}`);
    }
    live.rows = structuredClone(frame.rows);
    live.version = frame.version;
    return;
  }
  if (frame.kind === 'live_delta') {
    assert.equal(frame.subscription_id, live.subscriptionId, 'live delta crossed subscription');
    assert.equal(frame.function, 'listAnnouncements');
    if (live.forbidVisibleRows && frame.ops.some(({ op }) => op !== 'remove')) {
      assert.fail(`isolated live owner received a protected add/update delta: ${JSON.stringify(frame)}`);
    }
    const byId = new Map(live.rows.map((row) => [row._id, row]));
    for (const operation of frame.ops) {
      if (operation.op === 'remove') byId.delete(operation.id);
      else byId.set(operation.id, operation.row);
    }
    live.rows = [...byId.values()];
    live.version = frame.version;
    return;
  }
  assert.notEqual(frame.kind, 'resync_required', `unexpected RBAC live resync: ${JSON.stringify(frame)}`);
  assert.fail(`unexpected RBAC live frame: ${JSON.stringify(frame)}`);
}

async function drainLive(live) {
  const envelopes = await live.session.client.drainEnvelopes(live.connectionId);
  const frames = decodeDurableFrames(envelopes);
  for (const frame of frames) await applyLiveFrame(live, frame);
  return frames;
}

const messages = (live) => live.rows.map(({ message }) => message);
const authorityTransitions = (output) => output.authorityTransitions ?? [];

async function waitForMessages(live, expected, label) {
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;
  for (;;) {
    await drainLive(live);
    if (JSON.stringify(messages(live)) === JSON.stringify(expected)) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `SNAPBACK_RBAC_LIVE_TIMEOUT: ${label}: ${JSON.stringify(messages(live))}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function assertRemainsEmpty(live, quietMs, label) {
  const deadline = Date.now() + quietMs;
  do {
    await drainLive(live);
    assert.deepEqual(live.rows, [], label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
}

async function mintSession(appId, email, clientStoreId) {
  return asUser(server, appId, email, {
    clientStoreId,
    clientOptions: { authorizedLeaseProtocol: null },
    // Own the local resources before starting any request. If minting fails or
    // the outer watchdog cuts a non-settling server, finally still closes both.
    register(session) {
      session.closePromise = null;
      sessions.push(session);
    },
  });
}

async function disposeLiveSubscription(session, connectionId, subscriptionId) {
  let disposed;
  try {
    disposed = await session.client.unsubscribeLive('listAnnouncements', {
      connectionId,
      subscriptionId,
    });
  } catch (cause) {
    const diagnostic = cause?.diagnostic;
    throw new Error(
      `RBAC live disposal failed for ${connectionId}/${subscriptionId}: ${diagnostic?.code ?? cause?.code ?? cause?.message ?? 'unknown error'}${diagnostic?.message ? `: ${diagnostic.message}` : ''}`,
      { cause },
    );
  }
  assert.equal(disposed.subscription_id, subscriptionId);
  assert.equal(disposed.disposed, true);
}

try {
  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/u);
  assert.notEqual(server.launch?.rung, 'configured', 'the governed rung cannot use a configured binary');
  assert(
    ['verified', 'pinned-binary-dirty-checkout'].includes(server.identity?.verdict),
    `the governed rung requires an exact clean child build, got ${server.identity?.verdict ?? 'no identity'}`,
  );
  assert.match(server.identity.binary.gitCommit, /^[0-9a-f]{40}$/u);
  assert.equal(server.identity.binary.gitCommit, server.identity.expected.gitCommit);
  assert.equal(server.identity.binary.gitDirty, false);
  assert.equal(server.identity.binary.crateVersion, server.identity.expected.crateVersion);
  assert.equal(server.identity.binary.startupNonce, server.startupNonce);
  assert.equal(
    typeof server.governanceTargetConfigPath,
    'string',
    'the governed RBAC boot must expose its demo-kit-owned target config',
  );
  const governanceTargetConfig = await readJson(server.governanceTargetConfigPath);
  assert.equal(governanceTargetConfig.schemaVersion, 'snapback.visibility-governance-target-config.v1');
  assert.equal(governanceTargetConfig.targetClass, 'repository-local');
  assert.equal(governanceTargetConfig.verdict.providerProfile, 'repository-local-dev-mint-v1');
  assert.deepEqual(
    governanceTargetConfig.verdict.deploymentIdentities.map(({ appId }) => appId),
    [schema.appId],
  );
  console.log(`BOUND demo-kit rbac ${server.baseUrl}`);
  console.log(`MINTED demo-kit rbac governance target config ${server.governanceTargetConfigPath}`);
  console.log(
    `EXACT snapback child build ${server.identity.binary.gitCommit} ` +
      `${server.identity.binary.crateVersion} ${server.identity.binary.startupNonce}`,
  );
  await assertMissingGovernanceTargetRefusesBoot({
    binaryPath: server.runtimeRecovery?.selectedBinary,
    startupArtifacts: carrier,
  });
  // Expiry aborts every tracked client request and stops the isolated server.
  // Joining continues normally; a second live timer terminates the acceptance
  // process if either shutdown or joined work still refuses to settle.
  acceptanceWatchdog = new TerminalAcceptanceWatchdog({
    deadlineMs: ACCEPTANCE_WATCHDOG_MS,
    terminalGraceMs: ACCEPTANCE_TERMINAL_GRACE_MS,
    onDeadline(error) {
      process.stderr.write(
        `${error.code}: aborting clients and stopping a non-settling acceptance server\n`,
      );
      return Promise.allSettled([
        ...sessions.map((session) => closeAcceptanceSession(session)),
        stopServer(),
      ]);
    },
    onTerminal(error) {
      process.stderr.write(
        `${error.code}: forced terminal exit after ${ACCEPTANCE_TERMINAL_GRACE_MS}ms teardown grace\n`,
      );
      process.exit(124);
    },
  });

  const alice = await mintSession(schema.appId, 'alice@rbac.test', 'rbac-alice');
  const bob = await mintSession(schema.appId, 'bob@rbac.test', 'rbac-bob');
  const eve = await mintSession(schema.appId, 'eve@rbac.test', 'rbac-eve');

  const createdApp = await alice.client.mutate('createApp', {
    args: { name: 'RBAC acceptance' },
  });
  const appId = createdApp.result;
  assert.equal(typeof appId, 'string', 'atomic bootstrap returns the application id');
  const initialRoster = await alice.client.query('appAccess.list', {
    args: { scopeId: appId, page: { limit: 1 } },
  });
  assert.deepEqual(
    initialRoster.rows.map(({ userId, role }) => ({ userId, role })),
    [{ userId: alice.credential.session.userId, role: 'owner' }],
    'generated list projects the bootstrapped owner',
  );
  assert.deepEqual(
    (await alice.client.query('appAccess.myRole', { args: { scopeId: appId } })).rows,
    [{ role: 'owner', status: 'active' }],
    'generated myRole projects the authenticated owner',
  );
  await alice.client.mutate('postAnnouncement', {
    args: { appId, message: 'members only' },
  });

  const subscribe = async (
    session,
    connectionId,
    clientStoreId,
    { forbidVisibleRows = false } = {},
  ) => {
    return liveSubscriptions.start({
      label: `${clientStoreId} live subscription creation`,
      settlementDeadlineMs: OPERATION_TIMEOUT_MS,
      create: async (adopt) => {
        await session.client.connectionGrant(connectionId);
        const authorizationNamespace = namespaceFor(clientStoreId, appId);
        const subscription = await session.client.subscribeLive('listAnnouncements', {
          args: { appId },
          connectionId,
          authorizationNamespace,
        });
        const live = {
          session,
          connectionId,
          authorizationNamespace,
          subscriptionId: subscription.subscription_id,
          rows: [],
          version: null,
          authorizationInvalidations: 0,
          frames: [],
          forbidVisibleRows,
        };
        // Own the raw server-side success before any scope validation,
        // snapshot clone, or initial invalidation acknowledgement can fail.
        adopt(live);
        live.rows = structuredClone(subscription.snapshot.rows);
        live.version = subscription.snapshot.version;
        if (live.forbidVisibleRows && live.rows.length > 0) {
          assert.fail(`isolated live owner started with protected rows: ${JSON.stringify(live.rows)}`);
        }
        assertSubscriptionScope(live, subscription.authorizationScope, 'subscribe response');
        if (subscription.authorizationInvalidation) {
          await applyAuthorizationProjection(
            live,
            subscription.authorizationInvalidation,
            subscription.snapshot,
          );
        }
        return live;
      },
      dispose: async (live) => {
        // Disposal is owned just like creation: do not race and abandon a
        // possibly successful unsubscribe. The terminal watchdog aborts the
        // transport and process if it cannot settle.
        await disposeLiveSubscription(session, connectionId, live.subscriptionId);
      },
    });
  };
  const liveResults = await Promise.allSettled([
    subscribe(alice, 'rbac-alice-live', 'rbac-alice'),
    subscribe(bob, 'rbac-bob-live', 'rbac-bob', { forbidVisibleRows: true }),
    subscribe(eve, 'rbac-eve-live', 'rbac-eve', { forbidVisibleRows: true }),
  ]);
  const rejectedLive = liveResults.find((result) => result.status === 'rejected');
  if (rejectedLive) throw rejectedLive.reason;
  const [aliceLive, bobLive, eveLive] = liveResults.map((result) => result.value);
  assert.deepEqual(messages(aliceLive), ['members only']);
  assert.deepEqual(bobLive.rows, [], 'a non-member live subscription starts empty');
  assert.deepEqual(eveLive.rows, [], 'an unrelated non-member live subscription starts empty');

  await alice.client.mutate('postAnnouncement', {
    args: { appId, message: 'still members only' },
  });
  await waitForMessages(
    aliceLive,
    ['members only', 'still members only'],
    'Alice did not receive pre-grant member fanout',
  );
  await Promise.all([
    assertRemainsEmpty(
      bobLive,
      100,
      'pre-grant member fanout crossed into Bob live state',
    ),
    assertRemainsEmpty(
      eveLive,
      100,
      'pre-grant member fanout crossed into Eve live state',
    ),
  ]);

  const [aliceRows, bobRows] = await Promise.all([
    alice.client.query('listAnnouncements', { args: { appId } }),
    bob.client.query('listAnnouncements', { args: { appId } }),
  ]);
  assert.deepEqual(
    aliceRows.rows.map(({ message }) => message),
    ['members only', 'still members only'],
  );
  assert.deepEqual(bobRows.rows, [], 'a non-member cannot see existing rows');

  const searchRequest = {
    appId,
    query: { all: [{ Term: { value: 'members' } }] },
  };
  const [aliceSearch, bobSearch, eveSearch, absentScopeSearch] = await Promise.all([
    alice.client.search(api.searchAnnouncements, searchRequest),
    bob.client.search(api.searchAnnouncements, searchRequest),
    eve.client.search(api.searchAnnouncements, searchRequest),
    eve.client.search(api.searchAnnouncements, {
      ...searchRequest,
      appId: `${appId}-absent`,
    }),
  ]);
  assert.deepEqual(
    aliceSearch.items.map(({ fields }) => fields.message),
    ['members only', 'still members only'],
    'profile-backed membership search returns same-scope rows to a member',
  );
  const outsiderSearchBytes = JSON.stringify(bobSearch);
  assert.equal(
    JSON.stringify(eveSearch),
    outsiderSearchBytes,
    'two outsiders receive byte-identical nonenumerating search responses',
  );
  assert.equal(
    JSON.stringify(absentScopeSearch),
    outsiderSearchBytes,
    'an absent scope is byte-identical to the same query against a hidden existing scope',
  );
  assert.deepEqual(bobSearch.items, [], 'an outsider receives no protected search hits');

  await assert.rejects(
    () => bob.client.mutate('postAnnouncement', { args: { appId, message: 'not yet' } }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED',
    'ctx.permissions must deny a non-member with the invariant role diagnostic',
  );

  const bobInvalidationsBeforeJoin = bobLive.authorizationInvalidations;
  const bobUserId = bob.credential?.session?.userId;
  assert.equal(typeof bobUserId, 'string', 'Bob exchange returns the authenticated user id');
  const invite = await alice.client.mutate('appAccess.invite', {
    args: { scopeId: appId, principal: bobUserId, role: 'invited' },
  });
  assert.equal(invite.result, null);
  assert.deepEqual(
    authorityTransitions(invite)[0].successor,
    { role: 'invited', status: 'invited' },
  );
  const joined = await bob.client.mutate('appAccess.join', {
    args: { scopeId: appId, invitation: 'member' },
  });
  assert.equal(joined.result, null);
  assert.deepEqual(
    authorityTransitions(joined)[0].successor,
    { role: 'member', status: 'active' },
  );
  // The committed self-accept response is the exact boundary after which Bob may
  // become visible; every frame drained before it was checked as empty.
  bobLive.forbidVisibleRows = false;
  await waitForMessages(
    bobLive,
    ['members only', 'still members only'],
    'Bob membership invalidation did not refresh his live query',
  );
  assert(
    bobLive.authorizationInvalidations > bobInvalidationsBeforeJoin,
    'Bob membership grant must arrive as an authorization invalidation',
  );
  await drainLive(eveLive);
  assert.deepEqual(eveLive.rows, [], 'Bob membership invalidation crossed into Eve live state');
  assert.deepEqual(
    (await bob.client.search(api.searchAnnouncements, searchRequest)).items
      .map(({ fields }) => fields.message),
    ['members only', 'still members only'],
    'the profile grant admits search using the same role closure as list visibility',
  );

  const transferred = await alice.client.mutate('appAccess.transferOwner', {
    args: { scopeId: appId, principal: bobUserId },
  });
  assert.equal(transferred.result, null);
  assert.deepEqual(
    new Set(authorityTransitions(transferred).map(({ subject }) => subject)),
    new Set([alice.credential.session.userId, bobUserId]),
    'owner transfer receipts cover both changed subjects',
  );
  assert.deepEqual(
    (await bob.client.query('appAccess.myRole', { args: { scopeId: appId } })).rows,
    [{ role: 'owner', status: 'active' }],
    'transferOwner promotes the target',
  );
  const transferredBack = await bob.client.mutate('appAccess.transferOwner', {
    args: { scopeId: appId, principal: alice.credential.session.userId },
  });
  assert.equal(authorityTransitions(transferredBack).length, 2);

  await bob.client.mutate('postAnnouncement', {
    args: { appId, message: 'hello from bob' },
  });
  await Promise.all([
    waitForMessages(
      aliceLive,
      ['members only', 'still members only', 'hello from bob'],
      'Alice did not observe Bob announcement fanout',
    ),
    waitForMessages(
      bobLive,
      ['members only', 'still members only', 'hello from bob'],
      'Bob did not observe his announcement fanout',
    ),
  ]);
  await assertRemainsEmpty(
    eveLive,
    250,
    'member-only fanout crossed into Eve live state',
  );
  assert.deepEqual(
    (await bob.client.query('listAnnouncements', { args: { appId } })).rows
      .map(({ message }) => message),
    ['members only', 'still members only', 'hello from bob'],
  );

  const bobInvalidationsBeforeLeave = bobLive.authorizationInvalidations;
  const leave = await bob.client.mutate('appAccess.leave', { args: { scopeId: appId } });
  assert.equal(leave.result, null);
  assert.equal(authorityTransitions(leave)[0].successor, null);
  bobLive.forbidVisibleRows = true;
  await waitForMessages(bobLive, [], 'Bob self-leave did not revoke his live rows');
  assert(
    bobLive.authorizationInvalidations > bobInvalidationsBeforeLeave,
    'Bob self-leave must arrive as an authorization invalidation',
  );
  await assert.rejects(
    () => bob.client.mutate('postAnnouncement', { args: { appId, message: 'after leaving' } }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_PERMISSION_DENIED',
    'a self-leave must revoke subsequent role checks',
  );
  await alice.client.mutate('postAnnouncement', {
    args: { appId, message: 'revocation remains closed' },
  });
  const revocationSearchRequest = {
    appId,
    query: { all: [{ Term: { value: 'revocation' } }] },
  };
  const [revokedSearch, sameQueryOutsiderSearch] = await Promise.all([
    bob.client.search(api.searchAnnouncements, revocationSearchRequest),
    eve.client.search(api.searchAnnouncements, revocationSearchRequest),
  ]);
  assert.equal(
    JSON.stringify(revokedSearch),
    JSON.stringify(sameQueryOutsiderSearch),
    'revocation stops fresh protected results byte-identically to a same-query outsider',
  );

  assert.deepEqual(
    (await eve.client.query('listAnnouncements', { args: { appId } })).rows,
    [],
    'an unseated principal has no authority',
  );
  await assertRemainsEmpty(
    eveLive,
    250,
    'an unseated principal observed transient authority in live state',
  );

  // Keep the auth-scoped producers alive across the membership grant so this
  // acceptance proof still exercises invalidation and live fanout. The
  // lower-level membership corpus separately pins raw ctx.db refusal because
  // codegen now rejects such an authority-table operation before publication.
  // The finally block remains the best-effort failure path.
  await liveSubscriptions.closeAndDispose({ strict: true });

  console.log('rbac generated authoring and enforcement proof: ok');
} catch (error) {
  primaryFailure = error;
  throw error;
} finally {
  const cleanupFailures = [];
  try { await liveSubscriptions.closeAndDispose({ strict: false }); } catch (error) {
    cleanupFailures.push(error);
  }
  for (const session of sessions) {
    try { await closeAcceptanceSession(session); } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try { await stopServer(); } catch (error) { cleanupFailures.push(error); }
  try { await rm(scratch, { recursive: true, force: true }); } catch (error) {
    cleanupFailures.push(error);
  }
  if (cleanupFailures.length > 0) {
    const terminalFailure = new AggregateError(
      primaryFailure === null ? cleanupFailures : [primaryFailure, ...cleanupFailures],
      'RBAC acceptance teardown did not reach a clean terminal state',
    );
    // Keep the terminal backstop armed even when graceful stop has already
    // rejected. Throwing terminates the ordinary CLI path immediately; the
    // watchdog remains the bound if a harness intercepts that rejection.
    acceptanceWatchdog?.trigger(terminalFailure);
    throw terminalFailure;
  }
  try {
    await acceptanceWatchdog?.close();
  } catch (watchdogFailure) {
    if (primaryFailure !== null && watchdogFailure !== primaryFailure) {
      throw new AggregateError(
        [primaryFailure, watchdogFailure],
        'RBAC acceptance failed before its terminal watchdog was joined',
      );
    }
    throw watchdogFailure;
  }
}
