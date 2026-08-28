#!/usr/bin/env node

// Sound focused reproduction for LLP 0317.000 Wave 1 / O14.
//
// A delivery counts only when the managed socket stays attached and emits an
// authoritative live_replace/live_delta frame, or an authorization-invalidation
// snapshot naming the subscription that was open before the write. Poll
// fallback is disabled; a fresh subscription can never turn failed invalidation
// into a pass.
//
//   SNAPBACK_RUNTIME_BINARY=/path/to/snapback \
//     node demos/_kit/tests/live-query-invalidation-e2e.mjs --shape a,b,c --runs 10
//
// @ref LLP 0317.000#design-principles — verdicts stay per shape, retain
// negative evidence, and name the platform/client-arm limits they actually prove.

import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { IDBFactory } from 'fake-indexeddb';

import { createSnapbackAppClient } from '../../../packages/snapback-client/app-client.mjs';
import { generate } from '../../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../client.mjs';
import { createSuite, runAcceptance } from '../harness.mjs';
import { startServer } from '../server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const defineUrl = pathToFileURL(join(repoRoot, 'packages', 'snapback-codegen', 'define.mjs')).href;

const SHAPE_ORDER = Object.freeze(['a', 'b', 'c', 'd']);
const SHAPES = new Set(SHAPE_ORDER);
const DEFAULT_DELIVERY_DEADLINE_MS = 2_500;
const REPORTED_STALE_WINDOW_MS = 3_000;
const EXACT_REPORTED_ROWS = 179;
const PAST_IMPLICIT_CEILING_ROWS = 1_025;
const FAST_STREAM = Object.freeze({
  heartbeatIntervalMs: 500,
  freshnessBudgetMs: 4_000,
  reconnectBaseDelayMs: 100,
  reconnectMaxDelayMs: 400,
});
const AUTHORITATIVE_KINDS = new Set(['live_replace', 'live_delta']);

function diagnosticError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.diagnostic = { code, details };
  return error;
}

function positiveInteger(raw, flag, fallback) {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    allowRuntimeMismatch: false,
    deadlineMs: DEFAULT_DELIVERY_DEADLINE_MS,
    reportFile: null,
    runs: 1,
    shapes: [...SHAPE_ORDER],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--shape') {
      const raw = argv[++index];
      if (!raw) throw new Error('--shape requires a, b, c, d, all, or a comma-separated list');
      const requested = raw === 'all' ? [...SHAPE_ORDER] : raw.split(',');
      for (const shape of requested) {
        if (!SHAPES.has(shape)) throw new Error(`unknown shape ${JSON.stringify(shape)}`);
      }
      options.shapes = SHAPE_ORDER.filter((shape) => requested.includes(shape));
    } else if (flag === '--runs') {
      options.runs = positiveInteger(argv[++index], '--runs', 1);
    } else if (flag === '--deadline-ms') {
      options.deadlineMs = positiveInteger(
        argv[++index],
        '--deadline-ms',
        DEFAULT_DELIVERY_DEADLINE_MS,
      );
    } else if (flag === '--report-file') {
      options.reportFile = argv[++index] ?? null;
      if (!options.reportFile) throw new Error('--report-file requires a path');
    } else if (flag === '--allow-runtime-mismatch') {
      options.allowRuntimeMismatch = true;
    } else if (flag === '--help' || flag === '-h') {
      console.log(`Usage: node demos/_kit/tests/live-query-invalidation-e2e.mjs [options]

Options:
  --shape a|b|c|d|all   Shape(s) to run; comma-separated values accepted (default: all)
  --runs N              Fresh-server consecutive runs (default: 1; use 10 for negative evidence)
  --deadline-ms N       Original-subscription delivery deadline (default: ${DEFAULT_DELIVERY_DEADLINE_MS}; must be <= ${DEFAULT_DELIVERY_DEADLINE_MS}, strictly under the reported ${REPORTED_STALE_WINDOW_MS}ms stale window)
  --report-file PATH    Atomically retain the machine-readable report after cleanup
  --allow-runtime-mismatch
                        Development smoke only; dirty binaries are still refused
`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument ${JSON.stringify(flag)}`);
    }
  }
  if (options.deadlineMs > DEFAULT_DELIVERY_DEADLINE_MS) {
    throw new Error(
      `--deadline-ms must be <= ${DEFAULT_DELIVERY_DEADLINE_MS}ms so a pass stays strictly inside the reported ${REPORTED_STALE_WINDOW_MS}ms stale window`,
    );
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    count: list.length,
    ids: list.length <= 16 ? list.map((row) => row?._id ?? row?.id ?? null) : undefined,
    firstSequence: list[0]?.sequence ?? null,
    lastSequence: list.at(-1)?.sequence ?? null,
  };
}

function isExactMessageRange(rows, total) {
  return Array.isArray(rows)
    && rows.length === total
    && rows[0]?.sequence === 1
    && rows.at(-1)?.sequence === total;
}

function authoritativeCarrier(frame) {
  if (AUTHORITATIVE_KINDS.has(frame?.kind)) {
    return {
      subscriptionId: frame.subscription_id ?? null,
      version: frame.version ?? null,
      rows: frame.rows ?? null,
      ops: frame.ops ?? null,
    };
  }
  if (frame?.kind === 'authorization_invalidation' && frame.snapshot) {
    return {
      subscriptionId:
        frame.snapshot.subscription_id ?? frame.snapshot.subscriptionId ?? null,
      version: frame.snapshot.version ?? null,
      rows: frame.snapshot.rows ?? null,
      ops: null,
    };
  }
  return null;
}

function summarizeFrame(frame) {
  const carrier = authoritativeCarrier(frame);
  return {
    kind: frame?.kind ?? null,
    subscriptionId: carrier?.subscriptionId ?? frame?.subscription_id ?? null,
    version: carrier?.version ?? frame?.version ?? null,
    reason: frame?.reason ?? null,
    rows: Array.isArray(carrier?.rows) ? summarizeRows(carrier.rows) : null,
    ops: Array.isArray(carrier?.ops)
      ? carrier.ops.slice(0, 16).map((op) => ({
          op: op?.op ?? null,
          id: op?.id ?? null,
          rowId: op?.row?._id ?? null,
          sequence: op?.row?.sequence ?? null,
        }))
      : null,
    opCount: Array.isArray(carrier?.ops) ? carrier.ops.length : null,
    authorization: frame?.kind === 'authorization_invalidation'
      ? {
          scopeSubscriptionId:
            frame.obligation?.scopeId?.subscriptionId
            ?? frame.obligation?.scope_id?.subscription_id
            ?? null,
          revision: frame.obligation?.revision ?? null,
          maxDisposition:
            frame.obligation?.maxDisposition ?? frame.obligation?.max_disposition ?? null,
          hasResolution: frame.resolution != null,
          hasSnapshot: frame.snapshot != null,
        }
      : null,
  };
}

function createWitness(client, connectionId) {
  const manager = client.liveStreamManager(connectionId, FAST_STREAM);
  const frames = [];
  const managerStates = [];
  const connectionChanges = [];
  const subscriptionEvents = [];
  const authorizationBoundaries = [];
  const authorizationErrors = [];
  const updates = [];
  const waiters = new Set();

  const poke = () => {
    for (const waiter of [...waiters]) {
      if (!waiter.predicate()) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };
  const waitFor = (predicate, label, timeoutMs) => {
    if (predicate()) return Promise.resolve();
    return new Promise((resolveWait, reject) => {
      const waiter = {
        predicate,
        resolve: resolveWait,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`timed out waiting for ${label}`));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  };

  const stopFrame = manager.onDurable((frame) => {
    frames.push({ at: Date.now(), frame });
    poke();
  });
  const stopState = manager.onState((state, detail = {}) => {
    managerStates.push({
      at: Date.now(),
      state,
      wasOpen: detail?.wasOpen ?? null,
      error: detail?.error?.message ?? null,
    });
    poke();
  });

  return {
    client,
    authorizationBoundaries,
    authorizationErrors,
    connectionChanges,
    connectionId,
    frames,
    manager,
    managerStates,
    subscriptionEvents,
    updates,
    waitFor,
    liveOptions: {
      connectionId,
      transport: 'stream',
      fallbackToPoll: false,
      stream: FAST_STREAM,
      onUpdate(rows, meta = {}) {
        updates.push({
          at: Date.now(),
          kind: meta.kind ?? null,
          version: meta.version ?? null,
          rows: summarizeRows(rows),
        });
        poke();
      },
      onConnectionChange(connection, detail = {}) {
        connectionChanges.push({
          at: Date.now(),
          connection,
          previous: detail.previous ?? null,
          error: detail.error?.message ?? null,
        });
        poke();
      },
      onSubscriptionEvent(event) {
        subscriptionEvents.push({ at: Date.now(), ...event });
        poke();
      },
      onAuthorizationBoundary(rows, detail = {}) {
        authorizationBoundaries.push({
          at: Date.now(),
          kind: detail.kind ?? null,
          version: detail.version ?? null,
          disposition: detail.authorization?.kind ?? null,
          rows: summarizeRows(rows),
        });
        poke();
      },
      onAuthorizationError(error) {
        authorizationErrors.push({
          at: Date.now(),
          code: error?.diagnostic?.code ?? error?.code ?? null,
          message: error?.message ?? String(error),
        });
        poke();
      },
    },
    async ready(handle) {
      await waitFor(
        () => (
          typeof handle.subscriptionId === 'string'
          && handle.subscriptionId.length > 0
          && handle.connection === 'live'
          && manager.isOpen()
          && subscriptionEvents.some((event) => (
            event.event === 'established'
            && event.subscriptionId === handle.subscriptionId
            && event.transport === 'push'
          ))
        ),
        `push establishment for ${connectionId}`,
        2_500,
      );
    },
    baseline(handle) {
      return Object.freeze({
        subscriptionId: handle.subscriptionId,
        version: handle.version,
        frameIndex: frames.length,
        managerStateIndex: managerStates.length,
        connectionIndex: connectionChanges.length,
        eventIndex: subscriptionEvents.length,
        authorizationBoundaryIndex: authorizationBoundaries.length,
        authorizationErrorIndex: authorizationErrors.length,
        updateIndex: updates.length,
      });
    },
    stop() {
      stopState();
      stopFrame();
      for (const waiter of [...waiters]) {
        clearTimeout(waiter.timer);
        waiter.resolve();
      }
      waiters.clear();
    },
  };
}

function frameResultRows(frame) {
  const carrier = authoritativeCarrier(frame);
  if (Array.isArray(carrier?.rows)) return carrier.rows;
  if (Array.isArray(carrier?.ops)) {
    return carrier.ops.flatMap((op) => (op?.row === undefined || op?.row === null ? [] : [op.row]));
  }
  return [];
}

function findOriginalAuthoritativeFrame(witness, baseline, frameRowsMatch) {
  return witness.frames.slice(baseline.frameIndex).find(({ frame }) => {
    const carrier = authoritativeCarrier(frame);
    return carrier?.subscriptionId === baseline.subscriptionId
      && Number.isSafeInteger(carrier.version)
      && carrier.version > baseline.version
      && frameRowsMatch(frameResultRows(frame));
  }) ?? null;
}

async function originalSubscriptionDelivery({
  baseline,
  deadlineMs,
  frameRowsMatch = rowsMatch,
  handle,
  label,
  rowsMatch,
  settledAt,
  witness,
}) {
  const deadlineAt = settledAt + deadlineMs;
  let resultObservedAt = null;
  const qualifiesWithinDeadline = () => {
    const authoritative = findOriginalAuthoritativeFrame(witness, baseline, frameRowsMatch);
    if (authoritative === null || !rowsMatch(handle.rows)) return false;
    resultObservedAt ??= Date.now();
    return authoritative.at <= deadlineAt && resultObservedAt <= deadlineAt;
  };
  let timeoutError = null;
  try {
    await witness.waitFor(
      qualifiesWithinDeadline,
      label,
      deadlineMs,
    );
  } catch (error) {
    timeoutError = error.message;
  }

  const authoritative = findOriginalAuthoritativeFrame(witness, baseline, frameRowsMatch);
  if (authoritative !== null && rowsMatch(handle.rows)) resultObservedAt ??= Date.now();
  const events = witness.subscriptionEvents.slice(baseline.eventIndex);
  const managerStates = witness.managerStates.slice(baseline.managerStateIndex);
  const connectionChanges = witness.connectionChanges.slice(baseline.connectionIndex);
  const subscriptionIdUnchanged = handle.subscriptionId === baseline.subscriptionId;
  const resubscribed = events.some((event) => event.event === 'resubscribed');
  const managerStayedOpen = managerStates.every(({ state }) => state === 'open')
    && witness.manager.isOpen();
  const handleStayedLive = connectionChanges.every(({ connection }) => connection === 'live')
    && handle.connection === 'live';
  const resultMatches = rowsMatch(handle.rows);
  const authoritativeFrameWithinDeadline = authoritative !== null
    && authoritative.at <= deadlineAt;
  const resultObservedWithinDeadline = resultObservedAt !== null
    && resultObservedAt <= deadlineAt;
  const strict = timeoutError === null
    && authoritativeFrameWithinDeadline
    && resultObservedWithinDeadline
    && subscriptionIdUnchanged
    && !resubscribed
    && managerStayedOpen
    && handleStayedLive
    && resultMatches;
  const failures = [];
  if (authoritative === null) failures.push('no-authoritative-frame-on-original-subscription');
  if (
    authoritative !== null
    && (!authoritativeFrameWithinDeadline || !resultObservedWithinDeadline)
  ) failures.push('deadline-expired');
  if (!subscriptionIdUnchanged) failures.push('subscription-id-changed');
  if (resubscribed) failures.push('resubscribed-event');
  if (!managerStayedOpen || !handleStayedLive) failures.push('connection-detached');
  if (!resultMatches) failures.push('authoritative-result-stale');
  if (timeoutError !== null && failures.length === 0) failures.push('deadline-expired');

  return {
    delivered: strict,
    failures,
    timeoutError,
    deadlineMs,
    deadlineAt,
    originalSubscriptionId: baseline.subscriptionId,
    finalSubscriptionId: handle.subscriptionId,
    originalVersion: baseline.version,
    finalVersion: handle.version,
    invariants: {
      subscriptionIdUnchanged,
      resubscribed,
      managerStayedOpen,
      handleStayedLive,
      authoritativeFrameCarriesExpectedResult: authoritative !== null,
      authoritativeFrameWithinDeadline,
      resultObservedWithinDeadline,
      finalResultMatches: resultMatches,
    },
    authoritativeFrame: authoritative ? summarizeFrame(authoritative.frame) : null,
    afterSettlementMs: authoritative === null
      ? null
      : Math.max(0, authoritative.at - settledAt),
    resultObservedAfterSettlementMs: resultObservedAt === null
      ? null
      : Math.max(0, resultObservedAt - settledAt),
    subscriptionEvents: events.map(({ at: _at, ...event }) => event),
    authorizationBoundaries: witness.authorizationBoundaries
      .slice(baseline.authorizationBoundaryIndex),
    authorizationErrors: witness.authorizationErrors.slice(baseline.authorizationErrorIndex),
    managerStates,
    connectionChanges,
    updates: witness.updates.slice(baseline.updateIndex),
    frames: witness.frames
      .slice(baseline.frameIndex)
      .map(({ at: _at, frame }) => summarizeFrame(frame)),
  };
}

function backendSources() {
  const schema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({
  parents: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }).sync(),
  children: defineTable({
    parentId: v.id('parents'),
    lookupKey: v.string(),
    body: v.string(),
    revision: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_parent', ['parentId'])
    .index('by_lookup_key', ['lookupKey'])
    .sync(),
  messages: defineTable({
    sequence: v.integer(),
    body: v.string(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_sequence', ['sequence'])
    .sync(),
}, { auth: { mode: 'sessions' }, authProgram });
`;

  const functions = `
import {
  arg,
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  desc,
  eq,
  results,
  v,
} from '${defineUrl}';

export const parentWithChildren = defineJsLiveQuery({
  auth: 'authenticated',
  args: { parentId: v.id('parents') },
  result: results.records(v.object({
    parentId: v.id('parents'),
    name: v.string(),
    children: v.array(v.object({
      id: v.id('children'),
      body: v.string(),
      revision: v.integer(),
    }), { maxItems: 1024 }),
  }), { minItems: 0, maxItems: 1 }),
  reads: ['parents', 'children'],
  handler: async (ctx, args) => {
    const parent = await ctx.db.get('parents', args.parentId);
    if (!parent) return [];
    const children = await ctx.db
      .query('children')
      .withIndex('by_parent')
      .eq('parentId', parent._id)
      .collect();
    return [{
      parentId: parent._id,
      name: parent.name,
      children: children.map((child) => ({
        id: child._id,
        body: child.body,
        revision: child.revision,
      })),
    }];
  },
});

export const childrenForParent = defineLiveQuery({
  auth: 'authenticated',
  table: 'children',
  args: { parentId: v.id('parents') },
  filter: [eq('parentId', arg('parentId'))],
  index: 'by_parent',
});

export const childByKey = defineLiveQuery({
  auth: 'authenticated',
  table: 'children',
  args: { lookupKey: v.string() },
  filter: [eq('lookupKey', arg('lookupKey'))],
  index: 'by_lookup_key',
  limit: 1,
});

export const allMessages = defineJsLiveQuery({
  auth: 'public',
  args: {},
  result: results.documents('messages'),
  reads: ['messages'],
  handler: async (ctx) => ctx.db.query('messages').collect(),
});

export const latestMessage = defineLiveQuery({
  auth: 'public',
  table: 'messages',
  args: {},
  order: [desc('sequence')],
  index: 'by_sequence',
  limit: 1,
});

export const createParent = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  result: results.value(v.id('parents')),
  writes: ['parents'],
  handler: async (ctx, args) => ctx.db.insert('parents', { name: args.name }),
});

export const createChild = defineJsMutation({
  auth: 'authenticated',
  args: { parentId: v.id('parents'), lookupKey: v.string(), body: v.string() },
  result: results.value(v.id('children')),
  writes: ['children'],
  handler: async (ctx, args) => ctx.db.insert('children', {
    parentId: args.parentId,
    lookupKey: args.lookupKey,
    body: args.body,
    revision: 1,
  }),
});

export const patchChild = defineJsMutation({
  auth: 'authenticated',
  args: { childId: v.id('children'), body: v.string(), revision: v.integer() },
  result: results.value(v.boolean()),
  writes: ['children'],
  handler: async (ctx, args) => ctx.db.patch('children', args.childId, {
    body: args.body,
    revision: args.revision,
  }),
});

export const insertMessageBatch = defineJsMutation({
  auth: 'public',
  args: { startSequence: v.integer(), count: v.integer() },
  result: results.value(v.object({ inserted: v.integer(), lastSequence: v.integer() })),
  writes: ['messages'],
  handler: async (ctx, args) => {
    for (let offset = 0; offset < args.count; offset += 1) {
      const sequence = args.startSequence + offset;
      await ctx.db.insert('messages', { sequence, body: 'message-' + sequence });
    }
    return { inserted: args.count, lastSequence: args.startSequence + args.count - 1 };
  },
});
`;

  return { functions, schema };
}

async function prepareBackend(scratch) {
  const backendDir = join(scratch, 'snapback');
  mkdirSync(backendDir, { recursive: true });
  const sources = backendSources();
  writeFileSync(join(backendDir, 'schema.mjs'), sources.schema);
  writeFileSync(join(backendDir, 'functions.mjs'), sources.functions);
  writeFileSync(join(backendDir, 'seed.json'), '{"tables":{"parents":[],"children":[],"messages":[]}}\n');
  const generated = await generate(backendDir);
  if (!generated.ok) {
    throw diagnosticError(
      'O14_CODEGEN_FAILED',
      `O14 fixture codegen failed: ${JSON.stringify(generated.diagnostics)}`,
      { diagnostics: generated.diagnostics },
    );
  }
  const generatedDir = join(backendDir, 'generated');
  const schema = readJson(join(generatedDir, 'schema.manifest.json'));
  const functions = readJson(join(generatedDir, 'functions.manifest.json'));
  const app = generated.appDescriptor ?? readJson(join(generatedDir, 'app.descriptor.json'));
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  writeFileSync(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
    mode: 0o600,
  });
  return { app, backendDir, startupArtifacts };
}

function bindingFor(app, origin, runKey) {
  const now = Date.now();
  return Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([...app.capabilities.required, 'auth.passwords'])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: `o14-live-query-${runKey}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
}

async function readAndValidateRuntimeIdentity(server, runtimeBinary, allowRuntimeMismatch) {
  const response = await fetch(`${server.baseUrl}/health`);
  if (!response.ok) {
    throw diagnosticError(
      'O14_RUNTIME_HEALTH_FAILED',
      `runtime health returned HTTP ${response.status}`,
      { runtimeBinary, status: response.status },
    );
  }
  const health = await response.json();
  const binary = health?.binary;
  if (
    binary === null
    || typeof binary !== 'object'
    || typeof binary.gitCommit !== 'string'
    || !/^[0-9a-f]{40}$/u.test(binary.gitCommit)
    || typeof binary.gitDirty !== 'boolean'
  ) {
    throw diagnosticError(
      'O14_RUNTIME_IDENTITY_INVALID',
      'health.binary must directly carry a full gitCommit and boolean gitDirty',
      { binary: binary ?? null, runtimeBinary },
    );
  }
  if (binary.gitDirty !== false) {
    throw diagnosticError(
      'O14_RUNTIME_DIRTY_REFUSED',
      `runtime ${binary.gitCommit} was built from a dirty tree`,
      { binary, runtimeBinary },
    );
  }
  if (binary.gitCommit !== checkoutCommit && !allowRuntimeMismatch) {
    throw diagnosticError(
      'O14_RUNTIME_COMMIT_MISMATCH',
      `runtime ${binary.gitCommit} does not match checkout ${checkoutCommit}`,
      { binary, checkoutCommit, runtimeBinary },
    );
  }
  return { health, binary };
}

function browserPlatform(label, runKey) {
  return Object.freeze({
    kind: 'browser',
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-o14-${label}-${process.pid}-${runKey}`,
  });
}

async function stopIteration(iteration) {
  const results = await Promise.allSettled([
    iteration.operatorClient?.closeAuth(),
    iteration.clientB?.dispose(),
    iteration.clientA?.dispose(),
    iteration.server?.stop?.(),
  ]);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(failures.map((failure) => failure.reason), 'O14 iteration cleanup failed');
  }
}

async function startIteration(prepared, runtimeBinary, shape, runKey, options) {
  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: prepared.startupArtifacts,
    governanceBackendRoot: prepared.backendDir,
    serverBinary: runtimeBinary,
  });
  const partial = { clientA: null, clientB: null, operatorClient: null, server };
  try {
    const identity = await readAndValidateRuntimeIdentity(
      server,
      runtimeBinary,
      options.allowRuntimeMismatch,
    );
    const needsPersonaA = shape !== 'd';
    const needsPersonaB = shape === 'a' || shape === 'c';
    const binding = needsPersonaA ? bindingFor(prepared.app, server.baseUrl, runKey) : null;
    if (needsPersonaA) {
      partial.clientA = await createSnapbackAppClient({
        app: prepared.app,
        binding,
        platform: browserPlatform('persona-a', runKey),
        storagePartition: 'o14-persona-a',
      });
    }
    if (needsPersonaB) {
      partial.clientB = await createSnapbackAppClient({
        app: prepared.app,
        binding,
        platform: browserPlatform('persona-b', runKey),
        storagePartition: 'o14-persona-b',
      });
    }
    partial.operatorClient = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      custody: 'anonymous-public',
      offlineQueue: false,
      rqsStore: null,
    });
    const suffix = `${process.pid}-${runKey}`;
    if (needsPersonaA) {
      await partial.clientA.auth.signUpWithPassword({
        email: `o14-a-${suffix}@example.test`,
        password: `o14-persona-a-password-${suffix}`,
      });
    }
    if (needsPersonaB) {
      await partial.clientB.auth.signUpWithPassword({
        email: `o14-b-${suffix}@example.test`,
        password: `o14-persona-b-password-${suffix}`,
      });
    }
    return { ...partial, ...identity };
  } catch (error) {
    await Promise.allSettled([
      partial.operatorClient?.closeAuth(),
      partial.clientB?.dispose(),
      partial.clientA?.dispose(),
      server.stop?.(),
    ]);
    throw error;
  }
}

function partitionEvidence(iteration) {
  const a = iteration.clientA.bootstrapState();
  const b = iteration.clientB.bootstrapState();
  const principalA = iteration.clientA.auth.currentPrincipal().userId;
  const principalB = iteration.clientB.auth.currentPrincipal().userId;
  return {
    principalA,
    principalB,
    distinctPrincipals: principalA !== principalB,
    partitionHashA: a.custody.storagePartitionIdentityHash,
    partitionHashB: b.custody.storagePartitionIdentityHash,
    distinctPartitionHashes:
      a.custody.storagePartitionIdentityHash !== b.custody.storagePartitionIdentityHash,
    custodyA: a.custody.carrier,
    custodyB: b.custody.carrier,
  };
}

async function createParent(client, name) {
  const mutation = await client.mutate('createParent', { args: { name } });
  if (mutation.status !== 'settled') {
    throw diagnosticError(
      'O14_PARENT_NOT_SETTLED',
      'fixture parent mutation did not settle',
      { mutation },
    );
  }
  return mutation.result;
}

async function closeHandle(handle, witness) {
  try {
    await handle.dispose();
  } finally {
    witness.stop();
  }
}

async function shapeA(iteration, run, deadlineMs) {
  const writer = iteration.clientA.client;
  const subscriber = iteration.clientB.client;
  const partitions = partitionEvidence(iteration);
  if (!partitions.distinctPrincipals || !partitions.distinctPartitionHashes) {
    throw diagnosticError(
      'O14_A_PARTITION_CONTROL_INVALID',
      'shape (a) did not establish distinct principals and explicit storage partitions',
      partitions,
    );
  }

  const parentId = await createParent(writer, `shape-a-parent-${run}`);
  const lookupKey = `shape-a-child-${process.pid}-${run}`;
  const witness = createWitness(subscriber, `o14_a_subscriber_${run}`);
  const handle = await subscriber.liveQuery('childrenForParent', {
    args: { parentId },
    ...witness.liveOptions,
  });
  try {
    await witness.ready(handle);
    const baseline = witness.baseline(handle);
    const mutation = await writer.mutate('createChild', {
      args: { parentId, lookupKey, body: 'shape-a' },
    });
    const settledAt = Date.now();
    const childId = mutation.result;
    const delivery = await originalSubscriptionDelivery({
      baseline,
      deadlineMs,
      handle,
      label: 'shape (a) original-subscription cross-client invalidation',
      rowsMatch: (rows) => rows.some((row) => row._id === childId),
      settledAt,
      witness,
    });
    const fresh = await subscriber.query('childByKey', { args: { lookupKey } });
    const details = {
      partitions,
      mutationStatus: mutation.status,
      freshRows: summarizeRows(fresh.rows),
      delivery,
    };
    if (
      mutation.status !== 'settled'
      || fresh.rows.length !== 1
      || fresh.rows[0]?._id !== childId
      || !delivery.delivered
    ) {
      throw diagnosticError(
        'O14_A_ORIGINAL_SUBSCRIPTION_STALE',
        'shape (a) control failed: a committed distinct-partition write produced no authoritative frame on the still-attached original subscription',
        details,
      );
    }
    return details;
  } finally {
    await closeHandle(handle, witness);
  }
}

async function shapeB(iteration, run, deadlineMs) {
  const client = iteration.clientA.client;
  const parentId = await createParent(client, `shape-b-parent-${run}`);
  const lookupKey = `shape-b-child-${process.pid}-${run}`;
  const witness = createWitness(client, `o14_b_same_client_${run}`);
  const handle = await client.liveQuery('childrenForParent', {
    args: { parentId },
    ...witness.liveOptions,
  });
  try {
    await witness.ready(handle);
    const baseline = witness.baseline(handle);
    const mutation = await client.mutate('createChild', {
      args: { parentId, lookupKey, body: 'shape-b' },
    });
    const settledAt = Date.now();
    const childId = mutation.result;
    const presentAtSettlement = handle.rows.some((row) => row._id === childId);
    const delivery = await originalSubscriptionDelivery({
      baseline,
      deadlineMs,
      handle,
      label: 'shape (b) original-subscription own-write invalidation',
      rowsMatch: (rows) => rows.some((row) => row._id === childId),
      settledAt,
      witness,
    });
    const fresh = await client.query('childByKey', { args: { lookupKey } });
    const details = {
      mutationStatus: mutation.status,
      presentAtSettlement,
      freshRows: summarizeRows(fresh.rows),
      delivery,
    };
    if (
      mutation.status !== 'settled'
      || fresh.rows.length !== 1
      || fresh.rows[0]?._id !== childId
      || !delivery.delivered
    ) {
      throw diagnosticError(
        'O14_B_OWN_WRITE_ORIGINAL_SUBSCRIPTION_STALE',
        'shape (b) failed: the settled own-write was query-visible but produced no authoritative frame on the still-attached original subscription',
        details,
      );
    }
    return details;
  } finally {
    await closeHandle(handle, witness);
  }
}

async function childDeliveries({ baselines, deadlineMs, handles, settledAt, witnesses, matchers, phase }) {
  const entries = ['nested', 'list', 'point'];
  const outcomes = await Promise.all(entries.map((key) => originalSubscriptionDelivery({
    baseline: baselines[key],
    deadlineMs,
    handle: handles[key],
    label: `shape (c) ${key} ${phase} on original subscription`,
    rowsMatch: matchers[key],
    settledAt,
    witness: witnesses[key],
  })));
  return Object.fromEntries(entries.map((key, index) => [key, outcomes[index]]));
}

async function shapeC(iteration, run, deadlineMs) {
  const writer = iteration.clientA.client;
  const subscriber = iteration.clientB.client;
  const partitions = partitionEvidence(iteration);
  if (!partitions.distinctPrincipals || !partitions.distinctPartitionHashes) {
    throw diagnosticError(
      'O14_C_PARTITION_CONTROL_INVALID',
      'shape (c) did not establish distinct principals and explicit storage partitions',
      partitions,
    );
  }
  const parentId = await createParent(writer, `shape-c-parent-${run}`);
  const lookupKey = `shape-c-child-${process.pid}-${run}`;
  const connectionId = `o14_c_subscriber_${run}`;
  const witnesses = {
    nested: createWitness(subscriber, connectionId),
    list: createWitness(subscriber, connectionId),
    point: createWitness(subscriber, connectionId),
  };
  const handles = {
    nested: await subscriber.liveQuery('parentWithChildren', {
      args: { parentId },
      ...witnesses.nested.liveOptions,
    }),
    list: await subscriber.liveQuery('childrenForParent', {
      args: { parentId },
      ...witnesses.list.liveOptions,
    }),
    point: await subscriber.liveQuery('childByKey', {
      args: { lookupKey },
      ...witnesses.point.liveOptions,
    }),
  };
  try {
    await Promise.all(Object.entries(handles).map(([key, handle]) => witnesses[key].ready(handle)));
    const baselines = Object.fromEntries(
      Object.entries(handles).map(([key, handle]) => [key, witnesses[key].baseline(handle)]),
    );
    const inserted = await writer.mutate('createChild', {
      args: { parentId, lookupKey, body: 'inserted' },
    });
    const insertSettledAt = Date.now();
    const childId = inserted.result;
    const insert = await childDeliveries({
      baselines,
      deadlineMs,
      handles,
      settledAt: insertSettledAt,
      witnesses,
      phase: 'insert',
      matchers: {
        nested: (rows) => rows[0]?.children?.some((child) => child.id === childId),
        list: (rows) => rows.some((child) => child._id === childId),
        point: (rows) => rows.some((child) => child._id === childId),
      },
    });
    const freshAfterInsert = await subscriber.query('childByKey', { args: { lookupKey } });

    const patchBaselines = Object.fromEntries(
      Object.entries(handles).map(([key, handle]) => [key, witnesses[key].baseline(handle)]),
    );
    const patched = await writer.mutate('patchChild', {
      args: { childId, body: 'patched', revision: 2 },
    });
    const patchSettledAt = Date.now();
    const patchedRow = (row) => row.body === 'patched' && row.revision === 2;
    const patch = await childDeliveries({
      baselines: patchBaselines,
      deadlineMs,
      handles,
      settledAt: patchSettledAt,
      witnesses,
      phase: 'patch',
      matchers: {
        nested: (rows) => rows[0]?.children?.some((child) => child.id === childId && patchedRow(child)),
        list: (rows) => rows.some((child) => child._id === childId && patchedRow(child)),
        point: (rows) => rows.some((child) => child._id === childId && patchedRow(child)),
      },
    });
    const freshAfterPatch = await subscriber.query('childByKey', { args: { lookupKey } });
    const details = {
      partitions,
      insert: {
        mutationStatus: inserted.status,
        freshRows: summarizeRows(freshAfterInsert.rows),
        deliveries: insert,
      },
      patch: {
        mutationStatus: patched.status,
        freshRows: summarizeRows(freshAfterPatch.rows),
        deliveries: patch,
      },
    };
    const controlsPassed = inserted.status === 'settled'
      && patched.status === 'settled'
      && freshAfterInsert.rows.length === 1
      && freshAfterInsert.rows[0]?._id === childId
      && freshAfterPatch.rows[0]?._id === childId
      && freshAfterPatch.rows[0]?.body === 'patched'
      && freshAfterPatch.rows[0]?.revision === 2
      && insert.list.delivered
      && insert.point.delivered
      && patch.list.delivered
      && patch.point.delivered;
    if (!controlsPassed) {
      throw diagnosticError(
        'O14_C_DIRECT_CONTROL_FAILED',
        'shape (c) is inconclusive: a direct child-table control failed its original-subscription invariant',
        details,
      );
    }
    if (!insert.nested.delivered || !patch.nested.delivered) {
      throw diagnosticError(
        'O14_C_NESTED_DEPENDENCY_INVALIDATION_CONFIRMED',
        'shape (c) confirmed nested dependency invalidation failure: direct child subscriptions received authoritative original-subscription frames while the parent/child JS read set did not',
        details,
      );
    }
    return details;
  } finally {
    await Promise.allSettled([
      closeHandle(handles.point, witnesses.point),
      closeHandle(handles.list, witnesses.list),
      closeHandle(handles.nested, witnesses.nested),
    ]);
  }
}

async function queryOutcome(client, name) {
  try {
    const result = await client.query(name, { args: {} });
    return { ok: true, rows: summarizeRows(result.rows), diagnostic: null };
  } catch (error) {
    return {
      ok: false,
      rows: null,
      diagnostic: error.diagnostic ?? { code: error.code ?? null, message: error.message },
    };
  }
}

async function insertToTotal(client, currentTotal, targetTotal) {
  return client.mutate('insertMessageBatch', {
    args: { startSequence: currentTotal + 1, count: targetTotal - currentTotal },
  });
}

function transportContinuityFailed(delivery) {
  return delivery.failures.some((failure) => (
    failure === 'connection-detached'
    || failure === 'resubscribed-event'
    || failure === 'subscription-id-changed'
  ));
}

function originalSubscriptionQuarantine(delivery) {
  return delivery.frames.find((frame) => (
    frame.kind === 'authorization_invalidation'
    && frame.authorization?.scopeSubscriptionId === delivery.originalSubscriptionId
    && String(frame.authorization?.maxDisposition).toLowerCase() === 'quarantine'
    && frame.authorization?.hasSnapshot === false
  )) ?? null;
}

async function shapeD(iteration, run, deadlineMs) {
  const client = iteration.operatorClient;
  const witness179 = createWitness(client, `o14_d_179_${run}`);
  let handle179 = await client.liveQuery('allMessages', {
    args: {},
    ...witness179.liveOptions,
  });
  let witness1025 = null;
  let handle1025 = null;
  try {
    await witness179.ready(handle179);

    const baseline179 = witness179.baseline(handle179);
    const mutation179 = await insertToTotal(client, 0, EXACT_REPORTED_ROWS);
    const settled179 = Date.now();
    const delivery179 = await originalSubscriptionDelivery({
      baseline: baseline179,
      deadlineMs,
      frameRowsMatch: (rows) => rows.some((row) => row.sequence === EXACT_REPORTED_ROWS),
      handle: handle179,
      label: `shape (d) exact ${EXACT_REPORTED_ROWS}-row original-subscription delivery`,
      rowsMatch: (rows) => isExactMessageRange(rows, EXACT_REPORTED_ROWS),
      settledAt: settled179,
      witness: witness179,
    });
    const latest179 = await client.query('latestMessage', { args: {} });
    const fresh179 = await queryOutcome(client, 'allMessages');
    const at179 = {
      targetRows: EXACT_REPORTED_ROWS,
      mutationStatus: mutation179.status,
      latestRows: summarizeRows(latest179.rows),
      fresh: fresh179,
      liveRows: summarizeRows(handle179.rows),
      delivery: delivery179,
    };
    if (
      mutation179.status !== 'settled'
      || latest179.rows[0]?.sequence !== EXACT_REPORTED_ROWS
      || !fresh179.ok
      || fresh179.rows.count !== EXACT_REPORTED_ROWS
    ) {
      throw diagnosticError(
        'O14_D_179_CONTROL_FAILED',
        `shape (d) is inconclusive at exactly ${EXACT_REPORTED_ROWS} rows: committed/fresh controls failed`,
        { at179 },
      );
    }
    if (!delivery179.delivered) {
      if (transportContinuityFailed(delivery179)) {
        throw diagnosticError(
          'O14_D_179_TRANSPORT_INCONCLUSIVE',
          `shape (d) is inconclusive at ${EXACT_REPORTED_ROWS} rows: transport continuity failed before original-subscription invalidation could be judged`,
          { at179 },
        );
      }
      throw diagnosticError(
        'O14_D_179_SILENCE_CONFIRMED',
        `shape (d) confirmed the reported ${EXACT_REPORTED_ROWS}-row silence on the original subscription`,
        { at179 },
      );
    }

    await closeHandle(handle179, witness179);
    handle179 = null;

    const fill = await insertToTotal(client, EXACT_REPORTED_ROWS, 1_023);
    const latest1023 = await client.query('latestMessage', { args: {} });
    if (fill.status !== 'settled' || latest1023.rows[0]?.sequence !== 1_023) {
      throw diagnosticError(
        'O14_D_FILL_CONTROL_FAILED',
        'shape (d) is inconclusive: the no-subscriber fill to 1,023 rows failed',
        {
          at179,
          fillStatus: fill.status,
          latest1023: summarizeRows(latest1023.rows),
        },
      );
    }

    witness1025 = createWitness(client, `o14_d_1025_${run}`);
    handle1025 = await client.liveQuery('allMessages', {
      args: {},
      ...witness1025.liveOptions,
    });
    await witness1025.ready(handle1025);
    if (handle1025.rows.length !== 1_023) {
      throw diagnosticError(
        'O14_D_1023_SUBSCRIBE_CONTROL_FAILED',
        'shape (d) is inconclusive: the pre-ceiling subscription did not establish at 1,023 rows',
        { rows: summarizeRows(handle1025.rows) },
      );
    }

    const baseline1025 = witness1025.baseline(handle1025);
    const mutation1025 = await insertToTotal(
      client,
      1_023,
      PAST_IMPLICIT_CEILING_ROWS,
    );
    const settled1025 = Date.now();
    const delivery1025 = await originalSubscriptionDelivery({
      baseline: baseline1025,
      deadlineMs,
      frameRowsMatch: (rows) => rows.some((row) => (
        row.sequence === PAST_IMPLICIT_CEILING_ROWS
      )),
      handle: handle1025,
      label: `shape (d) ${PAST_IMPLICIT_CEILING_ROWS}-row original-subscription delivery`,
      rowsMatch: (rows) => isExactMessageRange(rows, PAST_IMPLICIT_CEILING_ROWS),
      settledAt: settled1025,
      witness: witness1025,
    });
    const latest1025 = await client.query('latestMessage', { args: {} });
    const fresh1025 = await queryOutcome(client, 'allMessages');
    const pastCeiling = {
      targetRows: PAST_IMPLICIT_CEILING_ROWS,
      mutationStatus: mutation1025.status,
      latestRows: summarizeRows(latest1025.rows),
      fresh: fresh1025,
      liveRows: summarizeRows(handle1025.rows),
      delivery: delivery1025,
    };
    const details = {
      at179,
      fill: {
        mutationStatus: fill.status,
        latestRows: summarizeRows(latest1023.rows),
        subscribedRows: 1_023,
      },
      pastCeiling,
    };
    if (
      mutation1025.status !== 'settled'
      || latest1025.rows[0]?.sequence !== PAST_IMPLICIT_CEILING_ROWS
    ) {
      throw diagnosticError(
        'O14_D_PAST_CEILING_CONTROL_FAILED',
        'shape (d) is inconclusive past the implicit ceiling: the bounded latest-row control failed',
        details,
      );
    }
    if (!delivery1025.delivered) {
      const implicitLimit = fresh1025.diagnostic?.code === 'SNAPBACK_QUERY_IMPLICIT_LIMIT_REACHED';
      const quarantine = originalSubscriptionQuarantine(delivery1025);
      const quarantineBlanked = delivery1025.updates.some((update) => (
        update.kind === 'authorization_quarantine' && update.rows.count === 0
      )) && handle1025.rows.length === 0;
      const continuityHeld = !transportContinuityFailed(delivery1025);
      details.pastCeiling.mechanismEvidence = {
        implicitLimit,
        continuityHeld,
        quarantine,
        quarantineBlanked,
      };
      if (implicitLimit && continuityHeld && quarantine !== null && quarantineBlanked) {
        throw diagnosticError(
          'O14_D_IMPLICIT_LIMIT_SILENCE_CONFIRMED',
          'shape (d) confirmed the mechanism: the implicit 1,024-row collect ceiling refuses reevaluation, emits quarantine without a successor snapshot, and blanks the still-attached original subscription',
          details,
        );
      }
      throw diagnosticError(
        'O14_D_PAST_CEILING_INCONCLUSIVE',
        'shape (d) is inconclusive past the implicit ceiling: the original subscription did not deliver, but the bound-refusal/quarantine mechanism was not proved end to end',
        details,
      );
    }
    return details;
  } finally {
    const cleanups = [];
    if (handle1025 !== null) cleanups.push(closeHandle(handle1025, witness1025));
    if (handle179 !== null) cleanups.push(closeHandle(handle179, witness179));
    await Promise.all(cleanups);
  }
}

const shapeFunctions = Object.freeze({ a: shapeA, b: shapeB, c: shapeC, d: shapeD });
const options = parseArgs(process.argv.slice(2));
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY;
if (typeof runtimeBinary !== 'string' || runtimeBinary.length === 0) {
  throw new Error('SNAPBACK_RUNTIME_BINARY must name the already-built Snapback binary');
}
if (!existsSync(runtimeBinary)) {
  throw new Error(`SNAPBACK_RUNTIME_BINARY does not exist: ${runtimeBinary}`);
}

const scratch = mkdtempSync(join(tmpdir(), 'snapback-o14-live-query-'));
const suite = createSuite('LLP 0317.000 O14 sound live-query invalidation', {
  expectedChecks: options.shapes.length * options.runs,
});
const execution = {
  requestedShapes: options.shapes,
  requestedRuns: options.runs,
  attemptedByShape: Object.fromEntries(SHAPE_ORDER.map((shape) => [shape, 0])),
  passedByShape: Object.fromEntries(SHAPE_ORDER.map((shape) => [shape, 0])),
  stoppedAfterShapeAControlFailure: false,
  checkoutCommit,
  runtimeBinary: resolve(runtimeBinary),
  allowRuntimeMismatch: options.allowRuntimeMismatch,
  evidenceEligibleForCurrentCheckout: false,
  deadlineMs: options.deadlineMs,
  platform: { os: process.platform, arch: process.arch, clientArm: 'headless-browser-shaped' },
  scopeLimitations: [
    'headless browser-shaped clients, not real browser contexts',
    'macOS arm64, not the reported Linux x86_64 platform',
    'source checkout client packages, not the published 0.1.29 client bundle',
  ],
  serverBinaries: [],
};

await runAcceptance(suite, async () => {
  const prepared = await prepareBackend(scratch);
  runs:
  for (let run = 1; run <= options.runs; run += 1) {
    for (const shape of options.shapes) {
      const iteration = await startIteration(
        prepared,
        resolve(runtimeBinary),
        shape,
        `${shape}-${run}`,
        options,
      );
      let failed = false;
      try {
        execution.attemptedByShape[shape] += 1;
        execution.serverBinaries.push(iteration.binary);
        if (
          !options.allowRuntimeMismatch
          && iteration.binary.gitCommit === checkoutCommit
          && iteration.binary.gitDirty === false
        ) {
          execution.evidenceEligibleForCurrentCheckout = true;
        }
        await suite.check(`shape (${shape}) run ${run}/${options.runs}`, async () => {
          try {
            return await shapeFunctions[shape](iteration, run, options.deadlineMs);
          } catch (error) {
            failed = true;
            throw error;
          }
        });
        if (!failed) execution.passedByShape[shape] += 1;
      } finally {
        await stopIteration(iteration);
      }
      if (shape === 'a' && failed) {
        execution.stoppedAfterShapeAControlFailure = true;
        break runs;
      }
    }
  }
}, {
  cleanups: [() => rmSync(scratch, { recursive: true, force: true })],
  reportExtra: execution,
  reportFile: options.reportFile === null ? null : resolve(options.reportFile),
});
