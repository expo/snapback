import assert from 'node:assert/strict';
import {mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, resolve, sep} from 'node:path';

import {loadFixtureAgainstReadyFile} from '../../scripts/load-fixture.mts';

import {
  machineIdentity,
  redactDiagnostic,
  sha256Bytes,
  sha256File,
} from './receipt.mjs';

// @ref LLP 0183#acceptance-program — Stage B composes the already-landed
// lane receipts without weakening their exact counts or fresh-server setup.

export const CONTROL_ROOT = resolve(import.meta.dirname, '../..');
export const ZERBUGS_ROOT = resolve(CONTROL_ROOT, '..');
export const REPO_ROOT = resolve(CONTROL_ROOT, '../../..');

export const ACCEPTANCE_PATH = join(ZERBUGS_ROOT, 'manifest/acceptance.v1.json');
export const INVENTORY_PATH = join(ZERBUGS_ROOT, 'stage0/inventory.v1.json');
export const FIXTURE_DIGESTS_PATH = join(CONTROL_ROOT, 'tests/fixtures/fixture-digests.json');
export const GENERATED_ROOT = join(CONTROL_ROOT, 'snapback/generated');
export const ARTIFACTS_PATH = join(GENERATED_ROOT, 'artifacts.json');
export const SCHEMA_MANIFEST_PATH = join(GENERATED_ROOT, 'schema.manifest.json');
export const FUNCTIONS_MANIFEST_PATH = join(GENERATED_ROOT, 'functions.manifest.json');
export const CAPABILITY_MANIFEST_PATH = join(GENERATED_ROOT, 'capability.manifest.json');
export const CONTRACT_DATA_MANIFEST_PATH = join(GENERATED_ROOT, 'contract-data.manifest.json');
export const COMPOSITION_PATH = join(CONTROL_ROOT, 'composition/zerobugs-control-composition.v1.json');
export const PLAN_PATH = join(CONTROL_ROOT, 'PLAN.md');

export const FROZEN_QUERY_NAMES = Object.freeze([
  'allLabels',
  'allUsers',
  'allProjects',
  'user',
  'crewUser',
  'labels',
  'labelsOrderByName',
  'issuePreloadV2',
  'userPref',
  'usersForProject',
  'commentsPage',
  'comment',
  'issueDetail',
  'issueListV2',
  'listIssueByID',
  'emojiChange',
  'prevNext',
  'issueList',
  'userPicker',
]);

export const FROZEN_MUTATION_NAMES = Object.freeze([
  'issue.create',
  'issue.update',
  'issue.delete',
  'issue.addLabel',
  'issue.removeLabel',
  'notification.update',
  'emoji.addToIssue',
  'emoji.addToComment',
  'emoji.remove',
  'comment.add',
  'comment.edit',
  'comment.remove',
  'label.create',
  'label.createAndAddToIssue',
  'viewState.set',
  'userPref.set',
]);

// Lane 4 deliberately executes issue.delete last so every preceding scenario
// can share the created issue and the delete proof can select a bounded cascade
// candidate. Its check ids follow scenario declaration order, not the frozen
// inventory's presentation order.
export const LANE4_MUTATION_LOGICAL_NAMES = Object.freeze([
  'issue.create',
  'issue.update',
  'issue.addLabel',
  'issue.removeLabel',
  'notification.update',
  'emoji.addToIssue',
  'comment.add',
  'emoji.addToComment',
  'emoji.remove',
  'comment.edit',
  'comment.remove',
  'label.create',
  'label.createAndAddToIssue',
  'viewState.set',
  'userPref.set',
  'issue.delete',
]);

export const LANE_CHECK_IDS = Object.freeze({
  lane2: Object.freeze([
    'five-frozen-actors-bind-and-rebinding-refuses',
    'unbound-principal-refused',
    'binding-surface-is-closed-to-frozen-five',
    'crew-guard-admits-crew-and-refuses-ordinary',
    'ownership-admits-creator-and-refuses-assignee',
    'anonymous-refused-on-principal-bound-path',
    'forged-or-expired-bearer-refused',
    'logout-route-and-user-switch-retire-predecessor-overlay',
    'private-overlay-has-no-caller-selected-identity-bypass',
  ]),
  lane3: Object.freeze([
    'fresh-fixture-and-lane2-bindings',
    'catalog-and-point-query-parity',
    'project-label-ordering-parity',
    'project-users-and-deprecated-picker-parity',
    'list-every-filter-and-combined-parity',
    'list-four-sort-modes-and-bidirectional-keysets',
    'deprecated-list-and-prev-next-share-oracle',
    'permalink-inside-outside-window-and-authoritative-not-found',
    'issue-detail-and-public-comment-graph-parity',
    'public-comments-and-emoji-pages-match-source-rows',
    'internal-policy-visibility-list-detail-preload',
    'child-roots-prove-parent-before-release',
    'principal-overlays-never-cross-actor-boundaries',
    'small-window-declares-incompleteness',
    'preload-graph-has-bounded-child-facts',
    'all-frozen-query-names-exercised',
  ]),
  lane4: Object.freeze([
    'settled-start-fixture-and-lane2-bindings',
    'frozen-lowering-inventory-and-current-ir-fallback',
    ...LANE4_MUTATION_LOGICAL_NAMES.map((name, index) => (
      `mutator-${String(index + 1).padStart(2, '0')}-${name}`
    )),
  ]),
  lane5: Object.freeze([
    'settled-start-fresh-fixture-and-bindings',
    'composition-manifest-gateway-health-and-release-identity',
    'route-01-02-local-github-oauth-shape',
    'route-05-get-queries-alias',
    'route-06-query-alias-auth-malformed-and-oversized',
    'route-04-mutate-alias-and-trigger-identity',
    'route-03-push-alias-session-custody',
    'route-09-machine-markdown-public-parity',
    'route-09-machine-markdown-internal-crew-gate',
    'effect-eight-trigger-classes-exact-capture-and-internal-recipients',
    'effect-fault-before-send-retries-from-durable-intent-once',
    'effect-fault-after-send-is-explicitly-ambiguous-and-fenced',
    'route-08-safe-unsubscribe-get-post-expiry-forgery-replay',
    'route-07-upload-five-types-server-policy-delivery-and-cleanup',
    'all-eight-nontriggers-produce-no-delivery',
    'gateway-shutdown-port-process-and-file-cleanup',
  ]),
  lane6a: Object.freeze([
    'fresh-config-fixture-and-bindings',
    'adapter-initial-window-and-outside-permalink',
    'controller-bidirectional-walk-matches-lane3-oracle',
    'reducer-paints-then-authoritative-result-settles',
    'refusal-drops-and-rebases-optimistic-layer',
    'session-switch-blanks-predecessor-before-successor',
  ]),
});

const LANE_SCHEMAS = Object.freeze({
  lane2: 'zerobugs-lane2-live.v1',
  lane3: 'zerobugs-lane3-live.v1',
  lane4: 'zerobugs-lane4-live.v1',
  lane5: 'zerobugs-lane5-live.v1',
  lane6a: 'zerobugs-lane6a-live.v1',
});

const MUTATION_TRACE_PRELOAD = join(import.meta.dirname, 'mutation-trace-preload.mjs');
const PROCESS_OUTPUT_PRELOAD = join(import.meta.dirname, 'process-output-preload.mjs');
const PROCESS_OUTPUT_TAIL_LINES = 40;

export async function loadGateContext(extraRawPaths = []) {
  const [
    acceptance,
    inventory,
    fixtureDigests,
    artifacts,
    schemaManifest,
    functionsManifest,
    capabilityManifest,
    contractDataManifest,
    composition,
  ] = await Promise.all([
    readJson(ACCEPTANCE_PATH),
    readJson(INVENTORY_PATH),
    readJson(FIXTURE_DIGESTS_PATH),
    readJson(ARTIFACTS_PATH),
    readJson(SCHEMA_MANIFEST_PATH),
    readJson(FUNCTIONS_MANIFEST_PATH),
    readJson(CAPABILITY_MANIFEST_PATH),
    readJson(CONTRACT_DATA_MANIFEST_PATH),
    readJson(COMPOSITION_PATH),
  ]);
  const rawPaths = [
    ACCEPTANCE_PATH,
    INVENTORY_PATH,
    FIXTURE_DIGESTS_PATH,
    ARTIFACTS_PATH,
    SCHEMA_MANIFEST_PATH,
    FUNCTIONS_MANIFEST_PATH,
    CAPABILITY_MANIFEST_PATH,
    CONTRACT_DATA_MANIFEST_PATH,
    COMPOSITION_PATH,
    PLAN_PATH,
    join(import.meta.dirname, 'gate-support.mjs'),
    ...extraRawPaths,
  ];
  return Object.freeze({
    acceptance,
    inventory,
    fixtureDigests,
    artifacts,
    schemaManifest,
    functionsManifest,
    capabilityManifest,
    contractDataManifest,
    composition,
    rawArtifacts: await rawArtifactRecords(rawPaths),
  });
}

/**
 * Own the complete headless stack. The scratch registration is made before
 * the server registration, so reverse cleanup stops the process before
 * deleting its database and readiness sidecars.
 */
export async function createHeadlessStack(gate, gateName) {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), `zerobugs-${gateName}-`)));
  gate.registerCleanup({
    label: `${gateName.toUpperCase()} scratch namespace`,
    targets: [{kind: 'directory', path: scratch}],
    run: () => rm(scratch, {recursive: true, force: true}),
  });

  const [schema, functions] = await Promise.all([
    readJson(SCHEMA_MANIFEST_PATH),
    readJson(FUNCTIONS_MANIFEST_PATH),
  ]);
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  await writeFile(
    startupArtifacts,
    `${JSON.stringify({formatVersion: 1, schema, functions})}\n`,
    {mode: 0o600},
  );
  const server = await gate.startServer({
    db: join(scratch, 'zerobugs.sqlite'),
    cwd: REPO_ROOT,
    startupArtifacts,
    captureImpersonationCapability: true,
    serverBinary: process.env.SNAPBACK_SERVER_BINARY
      ?? process.env.SNAPBACK_RUNTIME_BINARY
      ?? null,
    env: {
      SNAPBACK_OUTBOUND_ACTIONS: '1',
      ZERBUGS_TEST_DEFAULTS: '1',
    },
  });
  const readyFile = join(scratch, 'server.ready.json');
  const adminFile = join(scratch, 'admin.carrier');
  const impersonationFile = `${readyFile}.impersonation`;
  const processOutputFile = join(scratch, 'owned-process-output.log');
  const configEntries = [
    ['loopsApiKey', `${gateName}-local-mail-provider-v1`],
    ['discordWebhookToken', `${gateName}-local-webhook-provider-v1`],
    ['captureAdapterAuth', `${gateName}-local-capture-provider-v1`],
  ];
  const sensitiveValues = Object.freeze([
    String(server.adminToken),
    String(server.impersonationCapability),
    ...configEntries.map(([, value]) => value),
  ]);

  try {
    assert.equal(server.reused, false, `${gateName} owns a fresh server`);
    assert(server.adminToken, `${gateName} server exposes its owned admin carrier`);
    assert(server.impersonationCapability, `${gateName} server exposes its test impersonation carrier`);
    await writeFile(adminFile, `${server.adminToken}\n`, {mode: 0o600});
    await writeFile(impersonationFile, String(server.impersonationCapability), {mode: 0o600});
    await writeFile(processOutputFile, '', {mode: 0o600});
    const port = Number(new URL(server.baseUrl).port);
    await writeFile(readyFile, `${JSON.stringify({
      schemaVersion: 'snapback.v0',
      descriptorKind: 'snapbackHostReady',
      startupId: `srt-${gateName}-${server.pid}`,
      ready: true,
      serverUrl: server.baseUrl,
      host: '127.0.0.1',
      port,
      pid: server.pid,
      startupNonce: server.startupNonce,
      target: {
        appId: 'zerobugs-control',
        appRoot: null,
        targetProfile: 'local-dev-sqlite-ibex',
        serverUrl: server.baseUrl,
      },
      database: {mode: 'sqlite', path: join(scratch, 'zerobugs.sqlite')},
      startedAtMs: Date.now(),
      adminGated: true,
      adminTokenFile: adminFile,
      impersonationCapabilityFile: impersonationFile,
      diagnostics: [],
    })}\n`, {mode: 0o600});

    // The app declares all three values required. Install them before the first
    // fixture row opens app data; lane5 may replace them with its capture-owned
    // values, still before its own reset/load.
    for (const [entry, value] of configEntries) {
      const response = await fetch(`${server.baseUrl}/_snapback/api/config/set`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': server.adminToken,
        },
        body: JSON.stringify({entry, value}),
      });
      const responseText = await response.text();
      assert.equal(response.status, 200, `${gateName} configured ${entry} before app data`);
      assert(!responseText.includes(value), `${entry} configuration receipt withholds its value`);
    }

    return Object.freeze({
      readyFile,
      scratch,
      serverUrl: server.baseUrl,
      actorReceiptFile: join(scratch, 'actor-bindings.json'),
      mutationTraceFile: join(scratch, 'mutation-trace.json'),
      processOutputFile,
      sensitiveValues,
      serverOutputTail: () => server.outputTail?.({lines: PROCESS_OUTPUT_TAIL_LINES}) ?? '',
    });
  } catch (error) {
    throw withProcessOutput(error, [{
      label: 'Snapback server',
      output: server.outputTail?.({lines: PROCESS_OUTPUT_TAIL_LINES}) ?? '',
    }], sensitiveValues);
  }
}

export async function runLaneHarness(lane, stack, {traceMutations = false} = {}) {
  const schemaVersion = LANE_SCHEMAS[lane];
  if (!schemaVersion) throw new TypeError(`unknown Zerobugs lane harness ${lane}`);
  try {
    await waitForSettledStack(stack.readyFile);
    // Lane 2 is intentionally only the actor/auth matrix. Unlike all later
    // live lanes, it does not own fixture loading, so its gate composition must
    // open app data here after required config and settled impersonation exist.
    if (lane === 'lane2') await loadFixtureAgainstReadyFile(stack.readyFile);
  } catch (error) {
    throw await withStackProcessOutput(error, stack, []);
  }
  const harness = join(import.meta.dirname, `${lane}-live.mts`);
  const command = [
    process.execPath,
    '--preload',
    PROCESS_OUTPUT_PRELOAD,
    ...(traceMutations ? ['--preload', MUTATION_TRACE_PRELOAD] : []),
    harness,
  ];
  let stdout;
  let stderr;
  let exitCode;
  try {
    const child = Bun.spawn(command, {
      cwd: CONTROL_ROOT,
      env: {
        ...process.env,
        SNAPBACK_READY_FILE: stack.readyFile,
        SNAPBACK_ACTOR_BINDINGS_RECEIPT: stack.actorReceiptFile,
        SNAPBACK_OUTBOUND_ACTIONS: '1',
        ZERBUGS_TEST_DEFAULTS: '1',
        ZBUGS_PROCESS_OUTPUT_FILE: stack.processOutputFile,
        ...(traceMutations ? {ZBUGS_MUTATION_TRACE_FILE: stack.mutationTraceFile} : {}),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  } catch (error) {
    throw await withStackProcessOutput(error, stack, []);
  }
  const receipt = parseLaneReceipt(stdout, schemaVersion);
  const processOutputTail = await stackProcessOutputTail(stack, [
    {label: `${lane} harness stderr`, output: stderr},
    {label: `${lane} harness stdout`, output: stdout},
  ]);
  if (!receipt) {
    const diagnostic = stderr.trim().slice(-4_096) || `child exited ${exitCode} without a receipt`;
    throw withProcessOutput(
      new Error(`ZBUGS_${lane.toUpperCase()}_RECEIPT_MISSING: ${diagnostic}`),
      [],
      [],
      processOutputTail,
    );
  }
  let mutationTrace = [];
  if (traceMutations) {
    try {
      const trace = await readJson(stack.mutationTraceFile);
      assert.equal(trace.schemaVersion, 'zerobugs-mutation-trace.v1');
      assert(Array.isArray(trace.events));
      mutationTrace = trace.events;
    } catch (error) {
      throw withProcessOutput(
        new Error(`ZBUGS_MUTATION_TRACE_MISSING: ${error instanceof Error ? error.message : String(error)}`),
        [],
        [],
        processOutputTail,
      );
    }
  }
  return Object.freeze({
    lane,
    receipt,
    exitCode,
    mutationTrace: Object.freeze(mutationTrace),
    processOutputTail,
  });
}

export function assertLaneCheck(result, id) {
  try {
    assert.equal(result.receipt.status, 'ok', `${result.lane} receipt status`);
    assert.equal(result.exitCode, 0, `${result.lane} child exit`);
    assert.equal(
      result.receipt.executedChecks,
      result.receipt.expectedChecks,
      `${result.lane} exact receipt count`,
    );
    assert.equal(result.receipt.expectedChecks, LANE_CHECK_IDS[result.lane].length);
    const row = result.receipt.checks.find(candidate => candidate.id === id);
    assert(row, `${result.lane} receipt contains ${id}`);
    assert.equal(row.status, 'pass', `${result.lane} ${id}`);
    return Object.freeze({
      lane: result.lane,
      sourceReceipt: result.receipt.schemaVersion,
      sourceCheck: id,
      sourceExpectedChecks: result.receipt.expectedChecks,
    });
  } catch (error) {
    throw withProcessOutput(error, [], [], result.processOutputTail);
  }
}

export function actorIdentityFromLaneReceipts(...results) {
  const bindings = results
    .map(result => result?.receipt?.actorBindings)
    .find(candidate => candidate && typeof candidate === 'object');
  if (!bindings) {
    return Object.freeze({
      mode: 'fresh bound sessions verified by landed lane setup checks',
      declaredActors: Object.keys(readFixtureActorBindingsFallback()),
    });
  }
  return Object.freeze({
    mode: 'fresh server-minted sessions; raw session carriers excluded',
    actors: Object.fromEntries(Object.entries(bindings).map(([actor, binding]) => [
      actor,
      {
        sourceUserID: binding.sourceUserID,
        principalSha256: sha256Bytes(String(binding.principal)),
      },
    ])),
  });
}

// The synchronous fallback is intentionally the frozen actor name set only;
// fixture IDs are supplied separately by fixtureIdentity/source accounting.
function readFixtureActorBindingsFallback() {
  return {
    'ordinary-user': true,
    creator: true,
    assignee: true,
    'crew-admin': true,
    'removed-member': true,
  };
}

export function mutationTraceFor(result, index) {
  const id = `zb-l4-applied-${String(index + 1).padStart(2, '0')}`;
  const events = result.mutationTrace.filter(event => event.clientMutationId === id);
  const initial = events[0];
  const replay = events[1];
  assert(initial, `${id} submit/settlement trace exists`);
  assert(replay, `${id} replay trace exists`);
  assert.equal(initial.outcome, 'fulfilled', `${id} settled authoritatively`);
  assert.equal(replay.outcome, 'fulfilled', `${id} replay settled`);
  return Object.freeze({initial, replay});
}

export async function buildGateReceiptFields(context, run, {
  actorIdentity,
  capabilityFacts,
  refusalFacts = [],
  sourceAccounting,
  custodyAccounting,
  workarounds = [],
}) {
  return {
    manifest: {
      id: context.acceptance.manifestId,
      path: repoPath(ACCEPTANCE_PATH),
      sha256: await sha256File(ACCEPTANCE_PATH),
    },
    generatedIdentities: await generatedIdentities(context),
    componentReleaseIdentities: [{
      id: context.composition.id,
      version: context.composition.version,
      status: context.composition.status,
      runtime: context.composition.runtime,
      snapbackRelease: context.composition.snapbackRelease,
      path: repoPath(COMPOSITION_PATH),
      sha256: await sha256File(COMPOSITION_PATH),
    }],
    fixtureIdentity: {
      id: context.fixtureDigests.fixtureId,
      extensionId: context.fixtureDigests.extensionId,
      seedVersion: context.fixtureDigests.seedVersion,
      digest: context.fixtureDigests.overall.contentDigest,
      rowCount: context.fixtureDigests.overall.rowCount,
      mode: 'fresh normal fixture plus policy extension; load verified by gate checks',
    },
    actorIdentity,
    browserIdentity: {
      mode: 'not-used-headless-server-gate',
      owner: 'browser-only facts are assigned to ZB5-ZB7',
    },
    machineIdentity: machineIdentity(),
    network: 'loopback-only; normal network profile',
    targetIdentity: {
      id: context.composition.snapbackRelease.targetProfileId,
      appId: context.artifacts.appId,
      schemaVersion: context.artifacts.schemaVersion,
      inputsHash: context.artifacts.inputsHash,
      schemaHash: context.artifacts.schemaHash,
      bundleHash: context.artifacts.bundleHash,
      mode: 'fresh local Ibex plus SQLite server',
    },
    rawArtifacts: context.rawArtifacts,
    capabilityFacts,
    refusalFacts,
    assistance: [
      {
        sequence: 1,
        at: run.startedAt,
        kind: 'governing-design',
        source: 'llp/0183-zerobugs-quality-surface.rfc.md',
        purpose: 'ZB acceptance and immutable evidence contract',
      },
      {
        sequence: 2,
        at: run.startedAt,
        kind: 'guide',
        source: 'guide/testing/acceptance.md',
        purpose: 'fresh owned server and non-vacuous check lifecycle',
      },
      {
        sequence: 3,
        at: run.startedAt,
        kind: 'landed-lane-evidence',
        source: 'demos/zerobugs/control/tests/acceptance/lane2-live.mts..lane6a-live.mts',
        purpose: 'reuse source-oracle, actor, mutation, effect, and adapter checks',
      },
    ],
    workarounds,
    sourceAccounting,
    custodyAccounting,
  };
}

export function gateCheckStatus(checks, id) {
  return checks.rows.find(row => row.id === id)?.status ?? 'MISSING';
}

async function generatedIdentities(context) {
  return await Promise.all([
    [SCHEMA_MANIFEST_PATH, context.schemaManifest],
    [FUNCTIONS_MANIFEST_PATH, context.functionsManifest],
    [CAPABILITY_MANIFEST_PATH, context.capabilityManifest],
    [CONTRACT_DATA_MANIFEST_PATH, context.contractDataManifest],
    [ARTIFACTS_PATH, context.artifacts],
  ].map(async ([path, manifest]) => ({
    id: manifest.artifactKind,
    path: repoPath(path),
    sha256: await sha256File(path),
    release: {
      appId: manifest.appId ?? context.artifacts.appId,
      schemaVersion: manifest.schemaVersion ?? context.artifacts.schemaVersion,
      inputsHash: manifest.inputsHash ?? context.artifacts.inputsHash,
      schemaHash: manifest.schemaHash ?? context.artifacts.schemaHash,
      bundleHash: manifest.bundleHash ?? context.artifacts.bundleHash,
      targetProfileId: manifest.targetProfileId
        ?? manifest.targetProfile
        ?? context.composition.snapbackRelease.targetProfileId,
    },
  })));
}

function parseLaneReceipt(stdout, schemaVersion) {
  for (const line of stdout.split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const candidate = JSON.parse(line);
      if (candidate.schemaVersion === schemaVersion) return candidate;
    } catch {
      // Child diagnostics may contain braces. Only the exact receipt wins.
    }
  }
  return null;
}

async function waitForSettledStack(readyFile) {
  const deadline = Date.now() + 30_000;
  let lastError = 'readiness descriptor has not appeared';
  while (Date.now() < deadline) {
    try {
      const firstText = await readFile(readyFile, 'utf8');
      const ready = JSON.parse(firstText);
      assert.equal(typeof ready.serverUrl, 'string', 'ready descriptor has serverUrl');
      assert.equal(ready.adminGated, true, 'gate server keeps session mint admin-gated');
      assert.equal(
        ready.impersonationCapabilityFile,
        `${readyFile}.impersonation`,
        'ready descriptor names its mechanical impersonation sidecar',
      );
      assert.match(
        (await readFile(ready.impersonationCapabilityFile, 'utf8')).trim(),
        /^sbic_[A-Za-z0-9_-]+\.[0-9a-f]{8}$/u,
      );
      assert.equal(typeof ready.adminTokenFile, 'string', 'ready descriptor names admin carrier');
      assert((await readFile(ready.adminTokenFile, 'utf8')).trim(), 'admin carrier is populated');
      assert.equal(await readFile(readyFile, 'utf8'), firstText, 'readiness stayed stable');
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
    }
  }
  throw new Error(`settled server start timed out: ${lastError}`);
}

async function withStackProcessOutput(error, stack, extraSources) {
  return withProcessOutput(
    error,
    [],
    [],
    await stackProcessOutputTail(stack, extraSources),
  );
}

async function stackProcessOutputTail(stack, extraSources) {
  let gatewayOutput = '';
  try {
    gatewayOutput = await readFile(stack.processOutputFile, 'utf8');
  } catch {
    // A setup failure may occur before the diagnostic file is created.
  }
  return formatProcessOutput([
    {label: 'Snapback server', output: stack.serverOutputTail?.() ?? ''},
    {label: 'companion gateway', output: gatewayOutput},
    ...extraSources,
  ], stack.sensitiveValues ?? []);
}

function formatProcessOutput(sources, sensitiveValues) {
  const sections = [];
  for (const {label, output} of sources) {
    const raw = String(output ?? '').trimEnd();
    if (!raw) continue;
    const lines = raw.split(/\r?\n/u).slice(-PROCESS_OUTPUT_TAIL_LINES);
    const redacted = lines.map(line => redactProcessLine(line, sensitiveValues));
    sections.push(`[${label}; last ${redacted.length} line${redacted.length === 1 ? '' : 's'}]\n${redacted.join('\n')}`);
  }
  return sections.length === 0
    ? '[owned processes produced no captured output]'
    : sections.join('\n');
}

function redactProcessLine(line, sensitiveValues) {
  let output = String(line);
  for (const value of sensitiveValues) {
    if (typeof value === 'string' && value.length >= 4) output = output.replaceAll(value, '<redacted>');
  }
  return redactDiagnostic(output);
}

function withProcessOutput(error, sources, sensitiveValues, preformatted = null) {
  const tail = preformatted ?? formatProcessOutput(sources, sensitiveValues);
  const original = error instanceof Error ? error : new Error(String(error));
  const message = `${original.message}\nRecent owned process output (redacted):\n${tail}`;
  const wrapped = new Error(message, {cause: original});
  if (original.code !== undefined) wrapped.code = original.code;
  if (original.diagnostic && typeof original.diagnostic === 'object') {
    wrapped.diagnostic = Object.freeze({...original.diagnostic, message});
  }
  return wrapped;
}

async function rawArtifactRecords(paths) {
  const unique = [...new Set(paths.map(path => resolve(path)))].sort();
  return await Promise.all(unique.map(async path => ({
    path: repoPath(path),
    sha256: await sha256File(path),
  })));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function repoPath(path) {
  return relative(REPO_ROOT, path).split(sep).join('/');
}
