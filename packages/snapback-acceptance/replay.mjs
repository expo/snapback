import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  createReadStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

// @ref LLP 0307.000#d2-the-contract — this module owns the deliberately
// storeless, live-query-free, settle-before-next replay lifecycle.
// @ref LLP 0307.000#d6-receipts-a-write-ahead-jsonl-log-not-an-outcome-journal
// — every transport identity reaches durable storage before dispatch.

export const REPLAY_DEFINITION_VERSION = 'snapback.replay-definition.v1';
export const REPLAY_RECEIPT_VERSION = 'snapback.replay-receipt.v1';
export const REPLAY_STATUS_VERSION = 'snapback.replay-status.v1';
export const REPLAY_DISPATCH_CARRIER_MAX_BYTES = 1_024 * 1_024;

/**
 * Conservative charge paired with the kernel parity test. The retained
 * MutationOutput carrier is capped at 65,536 bytes; the second 64 KiB covers
 * every replay-admitted identity/format/seal field even when the public result
 * is empty. It is deliberately an overestimate, never a storage projection.
 */
export const REPLAY_RETAINED_ROW_OVERHEAD_BYTES = 131_072;

export const REPLAY_CEILINGS = Object.freeze({
  retainedMutationRecordsPerAuthority: 1_024,
  retainedMutationBytesPerAuthority: 8 * 1_024 * 1_024,
  retainedMutationResultBytes: 65_536,
  queryTakeRows: 1_024,
  bufferedMutationWrites: 1_024,
  seedEffects: 1_024,
});

const DEFINITION = Symbol('snapback.replay.definition');
const DEFAULT_POOL_SIZE = 8;
const MAX_POOL_SIZE = 64;
const DEFAULT_ACK_COUNT = 256;
const DEFAULT_ACK_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_PROJECTION_BYTES = 64 * 1_024;
const DEFAULT_CHECKPOINT_CADENCE_MS = 1_000;
const MAX_FUNCTION_NAME_BYTES = 4_096;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;
const TERMINAL_STATUS_STATES = new Set(['complete', 'failed', 'stopped']);
const WAL_VERSIONS = new Set([
  'snapback.replay-dispatch.v1',
  'snapback.replay-terminal.v1',
  'snapback.replay-ack.v1',
  'snapback.replay-fence.v1',
  REPLAY_RECEIPT_VERSION,
]);

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function codedError(code, message, details = {}) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function positiveInteger(value, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw codedError(
      'SNAPBACK_REPLAY_DEFINITION_INVALID',
      `${label} must be an integer in [1, ${max}]`,
      { field: label, value },
    );
  }
  return value;
}

function absolutePath(value, label, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', `${label} is required`, { field: label });
  }
  if (value instanceof URL) {
    if (value.protocol !== 'file:') {
      throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', `${label} URL must use file:`);
    }
    return fileURLToPath(value);
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', `${label} must be a path`);
  }
  if (value.startsWith('file:')) return fileURLToPath(new URL(value));
  return resolve(value);
}

function moduleOrFunction(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'function') return value;
  return absolutePath(value, label);
}

function normalizeActors(actors) {
  const selected = actors ?? { mint: {} };
  if (!plainObject(selected)) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'actors must be an object');
  }
  const hasMint = plainObject(selected.mint);
  const hasBearer = Object.hasOwn(selected, 'bearerFor');
  if (hasMint === hasBearer) {
    throw codedError(
      'SNAPBACK_REPLAY_DEFINITION_INVALID',
      'actors must select exactly one of mint or bearerFor',
    );
  }
  if (hasBearer) {
    const bearerFor = moduleOrFunction(selected.bearerFor, 'actors.bearerFor');
    return Object.freeze({ kind: 'bearer', bearerFor });
  }
  const emailFor = moduleOrFunction(selected.mint.emailFor, 'actors.mint.emailFor');
  return Object.freeze({ kind: 'mint', emailFor });
}

export function defineReplay(options) {
  if (!plainObject(options)) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'replay definition must be an object');
  }
  const readyFile = absolutePath(options.readyFile, 'readyFile');
  const api = typeof options.api === 'string' || options.api instanceof URL
    ? absolutePath(options.api, 'api')
    : options.api;
  if (!plainObject(api) && typeof api !== 'string') {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'api must be a module path or API object');
  }
  const actions = typeof options.actions === 'string' || options.actions instanceof URL
    ? absolutePath(options.actions, 'actions')
    : options.actions;
  if (typeof actions !== 'string' && actions?.[Symbol.asyncIterator] === undefined) {
    throw codedError(
      'SNAPBACK_REPLAY_DEFINITION_INVALID',
      'actions must be a JSONL path or async iterable',
    );
  }
  const receiptsFile = absolutePath(options.receiptsFile ?? './replay-receipts.jsonl', 'receiptsFile');
  const statusFile = absolutePath(options.statusFile ?? './replay-status.json', 'statusFile');
  const sessionCustodyFile = absolutePath(
    options.sessionCustodyFile ?? `${receiptsFile}.sessions.json`,
    'sessionCustodyFile',
  );
  const transportCustody = options.transportCustody ?? 'minted';
  if (!['minted', 'none'].includes(transportCustody)) {
    throw codedError(
      'SNAPBACK_REPLAY_DEFINITION_INVALID',
      "transportCustody must be 'minted' or 'none'",
    );
  }
  const clientPool = positiveInteger(options.clientPool ?? DEFAULT_POOL_SIZE, 'clientPool', {
    max: MAX_POOL_SIZE,
  });
  const acknowledgeEvery = positiveInteger(
    options.acknowledgeEvery ?? DEFAULT_ACK_COUNT,
    'acknowledgeEvery',
  );
  const acknowledgeBytes = positiveInteger(
    options.acknowledgeBytes ?? DEFAULT_ACK_BYTES,
    'acknowledgeBytes',
  );
  const settlementProjectionBytes = positiveInteger(
    options.settlementProjectionBytes ?? DEFAULT_PROJECTION_BYTES,
    'settlementProjectionBytes',
  );
  const checkpointCadenceMs = positiveInteger(
    options.checkpointCadenceMs ?? DEFAULT_CHECKPOINT_CADENCE_MS,
    'checkpointCadenceMs',
  );
  if (
    options.idempotent !== undefined
    && typeof options.idempotent !== 'boolean'
    && typeof options.idempotent !== 'function'
    && typeof options.idempotent !== 'string'
  ) {
    throw codedError(
      'SNAPBACK_REPLAY_DEFINITION_INVALID',
      'idempotent must be boolean, a predicate, or a predicate module path',
    );
  }
  return Object.freeze({
    [DEFINITION]: true,
    schemaVersion: REPLAY_DEFINITION_VERSION,
    readyFile,
    api,
    actions,
    actors: normalizeActors(options.actors),
    clientPool,
    transportCustody,
    acknowledgeEvery,
    acknowledgeBytes,
    receiptsFile,
    statusFile,
    sessionCustodyFile,
    settlementProjectionBytes,
    checkpointCadenceMs,
    mapper: moduleOrFunction(options.mapper, 'mapper'),
    settlementProjection: moduleOrFunction(
      options.settlementProjection,
      'settlementProjection',
    ),
    idempotent: typeof options.idempotent === 'string'
      ? absolutePath(options.idempotent, 'idempotent')
      : options.idempotent ?? false,
  });
}

function assertDefinition(definition) {
  if (
    definition?.[DEFINITION] !== true
    || definition.schemaVersion !== REPLAY_DEFINITION_VERSION
  ) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'expected defineReplay() output');
  }
}

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function syncDirectory(path) {
  let descriptor = null;
  try {
    descriptor = openSync(dirname(path), 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function writePrivateJson(path, value) {
  ensureParent(path);
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeSync(descriptor, `${JSON.stringify(value)}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  syncDirectory(path);
}

function appendWal(path, record) {
  ensureParent(path);
  let descriptor = null;
  try {
    descriptor = openSync(path, 'a', 0o600);
    writeSync(descriptor, `${JSON.stringify(record)}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  // The first append may have created the WAL dirent. File fsync alone does
  // not make that name durable across a filesystem/power crash.
  syncDirectory(path);
}

function fileDigest(path) {
  const hash = createHash('sha256');
  if (existsSync(path)) hash.update(readFileSync(path));
  return `sha256:${hash.digest('hex')}`;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireFence(receiptsFile) {
  const lockFile = `${receiptsFile}.lock`;
  const startToken = randomUUID();
  const ownerRecord = { pid: process.pid, startToken, at: Date.now() };
  const ownerRecordBytes = `${JSON.stringify(ownerRecord)}\n`;
  let stale = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor = null;
    try {
      ensureParent(lockFile);
      descriptor = openSync(lockFile, 'wx', 0o600);
      writeSync(descriptor, ownerRecordBytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = null;
      syncDirectory(lockFile);
      if (stale !== null) {
        appendWal(receiptsFile, {
          v: 'snapback.replay-fence.v1',
          event: 'stale-broken',
          stale,
          by: { pid: process.pid, startToken },
          at: Date.now(),
        });
      }
      return Object.freeze({ lockFile, startToken });
    } catch (error) {
      if (descriptor !== null) closeSync(descriptor);
      if (error?.code !== 'EEXIST') throw error;
      let owner = null;
      let ownerBytes = null;
      try {
        ownerBytes = readFileSync(lockFile, 'utf8');
        owner = JSON.parse(ownerBytes);
      } catch {}
      if (processAlive(owner?.pid)) {
        throw codedError(
          'SNAPBACK_REPLAY_RUNNER_ACTIVE',
          `receipts WAL is held by live pid ${owner.pid}`,
          { receiptsFile, lockFile, pid: owner.pid },
        );
      }
      stale = owner ?? { unreadable: true };
      const reclaimFile = `${lockFile}.reclaim`;
      const replacementFile = `${lockFile}.${startToken}.replacement`;
      let reclaimDescriptor = null;
      let replacementDescriptor = null;
      let ownsReclaim = false;
      try {
        reclaimDescriptor = openSync(reclaimFile, 'wx', 0o600);
        ownsReclaim = true;
        writeSync(reclaimDescriptor, `${JSON.stringify({
          pid: process.pid,
          startToken,
          expectedOwnerSha256: ownerBytes === null
            ? null
            : createHash('sha256').update(ownerBytes).digest('hex'),
          at: Date.now(),
        })}\n`);
        fsyncSync(reclaimDescriptor);
        closeSync(reclaimDescriptor);
        reclaimDescriptor = null;
        syncDirectory(reclaimFile);

        // The O_EXCL reclamation lease serializes every conforming contender.
        // Compare the complete expected owner while holding that lease, then
        // atomically replace the stale name: there is no read/unlink gap in
        // which a freshly acquired live lock can be deleted.
        const currentBytes = readFileSync(lockFile, 'utf8');
        if (ownerBytes === null || currentBytes !== ownerBytes) continue;
        replacementDescriptor = openSync(replacementFile, 'wx', 0o600);
        writeSync(replacementDescriptor, ownerRecordBytes);
        fsyncSync(replacementDescriptor);
        closeSync(replacementDescriptor);
        replacementDescriptor = null;
        if (readFileSync(lockFile, 'utf8') !== ownerBytes) continue;
        renameSync(replacementFile, lockFile);
        syncDirectory(lockFile);
        appendWal(receiptsFile, {
          v: 'snapback.replay-fence.v1',
          event: 'stale-broken',
          stale,
          by: { pid: process.pid, startToken },
          at: Date.now(),
        });
        return Object.freeze({ lockFile, startToken });
      } catch (reclaimError) {
        if (reclaimError?.code !== 'EEXIST') throw reclaimError;
        let reclaimer = null;
        try { reclaimer = JSON.parse(readFileSync(reclaimFile, 'utf8')); } catch {}
        throw codedError(
          'SNAPBACK_REPLAY_RUNNER_ACTIVE',
          processAlive(reclaimer?.pid)
            ? `stale-fence reclamation is held by live pid ${reclaimer.pid}`
            : 'stale-fence reclamation was interrupted and requires explicit recovery',
          { receiptsFile, lockFile, reclaimFile, pid: reclaimer?.pid ?? null },
        );
      } finally {
        if (reclaimDescriptor !== null) closeSync(reclaimDescriptor);
        if (replacementDescriptor !== null) closeSync(replacementDescriptor);
        try { unlinkSync(replacementFile); } catch (cleanupError) {
          if (cleanupError?.code !== 'ENOENT') throw cleanupError;
        }
        if (ownsReclaim) {
          try {
            unlinkSync(reclaimFile);
            syncDirectory(reclaimFile);
          } catch (cleanupError) {
            if (cleanupError?.code !== 'ENOENT') throw cleanupError;
          }
        }
      }
    }
  }
  throw codedError(
    'SNAPBACK_REPLAY_RUNNER_ACTIVE',
    'receipts WAL fence changed repeatedly while acquiring it',
    { receiptsFile, lockFile },
  );
}

function releaseFence(fence) {
  if (fence === null) return;
  try {
    const owner = JSON.parse(readFileSync(fence.lockFile, 'utf8'));
    if (owner?.pid === process.pid && owner?.startToken === fence.startToken) {
      unlinkSync(fence.lockFile);
      syncDirectory(fence.lockFile);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function writeStatus(definition, status) {
  writePrivateJson(definition.statusFile, {
    v: REPLAY_STATUS_VERSION,
    checkpointCadenceMs: definition.checkpointCadenceMs,
    receiptsFile: definition.receiptsFile,
    updatedAt: Date.now(),
    ...status,
  });
}

function writeDetachedFailureStatus(statusFile, receiptsFile, diagnostic) {
  writePrivateJson(statusFile, {
    v: REPLAY_STATUS_VERSION,
    checkpointCadenceMs: DEFAULT_CHECKPOINT_CADENCE_MS,
    receiptsFile,
    updatedAt: Date.now(),
    state: 'failed',
    settled: 0,
    failed: 1,
    total: null,
    lastSeq: null,
    pid: process.pid,
    diagnostic,
  });
}

export function readReplayStatus(statusFile) {
  const path = absolutePath(statusFile, 'statusFile');
  let status;
  try {
    status = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw codedError(
      'SNAPBACK_REPLAY_STATUS_UNAVAILABLE',
      `replay status is unavailable at ${path}`,
      { statusFile: path, cause: error?.code ?? String(error) },
    );
  }
  if (status?.v !== REPLAY_STATUS_VERSION) {
    throw codedError('SNAPBACK_REPLAY_STATUS_INVALID', 'replay status has an unsupported version');
  }
  const projection = { ...status, statusFile: path };
  if (TERMINAL_STATUS_STATES.has(status.state)) return Object.freeze(projection);
  const alive = processAlive(status.pid);
  if (!alive) {
    return Object.freeze({ ...projection, state: 'dead', recovery: 'resume' });
  }
  const cadence = Number.isSafeInteger(status.checkpointCadenceMs)
    ? status.checkpointCadenceMs
    : DEFAULT_CHECKPOINT_CADENCE_MS;
  if (Date.now() - status.updatedAt > cadence * 3) {
    return Object.freeze({ ...projection, state: 'stalled', recovery: 'wait-or-signal' });
  }
  return Object.freeze(projection);
}

async function* jsonlRecords(path) {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim() === '') continue;
    let value;
    try { value = JSON.parse(line); } catch (error) {
      throw codedError(
        'SNAPBACK_REPLAY_ACTION_INVALID',
        `action JSONL line ${lineNumber} is not valid JSON`,
        { path, lineNumber, cause: String(error) },
      );
    }
    yield { value, lineNumber };
  }
}

function normalizeAction(raw, previousSeq = null) {
  if (!plainObject(raw)) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', 'each replay action must be an object');
  }
  const seq = raw.seq;
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', 'action seq must be non-negative integer');
  }
  if (previousSeq !== null && seq !== previousSeq + 1) {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `action seq ${seq} does not continue ${previousSeq}`,
      { seq, previousSeq },
    );
  }
  if (typeof raw.actor !== 'string' || raw.actor.length === 0) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `action ${seq} actor must be non-empty`);
  }
  if (raw.fn !== undefined && typeof raw.fn !== 'string' && !plainObject(raw.fn)) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `action ${seq} fn must be a reference or name`);
  }
  if (raw.fn === undefined && raw.args !== undefined) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `action ${seq} with args must name fn`);
  }
  const intent = raw.intent ?? `replay-${seq}`;
  if (typeof intent !== 'string' || intent.length === 0) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `action ${seq} intent must be non-empty`);
  }
  return Object.freeze({ ...raw, seq, actor: raw.actor, intent, args: raw.args ?? {} });
}

async function spoolActionSource(definition) {
  if (typeof definition.actions === 'string') {
    if (!existsSync(definition.actions)) {
      throw codedError(
        'SNAPBACK_REPLAY_ACTION_INVALID',
        `actions file does not exist: ${definition.actions}`,
      );
    }
    return Object.freeze({ path: definition.actions, resumeEligible: true, cleanup: null });
  }
  const path = `${definition.receiptsFile}.one-shot-${process.pid}-${randomUUID()}.jsonl`;
  ensureParent(path);
  let descriptor = null;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    for await (const raw of definition.actions) writeSync(descriptor, `${JSON.stringify(raw)}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
  syncDirectory(path);
  return Object.freeze({
    path,
    resumeEligible: false,
    cleanup() {
      try { unlinkSync(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    },
  });
}

async function inspectActions(source, api) {
  let total = 0;
  let previousSeq = null;
  let generatedIrReferences = 0;
  let deferredMapperActions = 0;
  const actors = new Set();
  for await (const { value } of jsonlRecords(source.path)) {
    const action = normalizeAction(value, previousSeq);
    previousSeq = action.seq;
    total += 1;
    actors.add(action.actor);
    if (action.fn === undefined) {
      deferredMapperActions += 1;
    } else if (
      resolveReference(api, action.fn, action.seq).mutationIr?.format
      === 'snapback.generated-mutation-ir.v1'
    ) {
      generatedIrReferences += 1;
    }
  }
  return Object.freeze({
    total,
    firstSeq: total === 0 ? null : previousSeq - total + 1,
    generatedIrReferences,
    deferredMapperActions,
    actors: Object.freeze([...actors]),
  });
}

function readWal(path) {
  const records = [];
  if (!existsSync(path)) return records;
  const text = readFileSync(path, 'utf8');
  if (text.length === 0) return records;
  const lines = text.split('\n');
  if (lines.at(-1) !== '') {
    throw codedError(
      'SNAPBACK_REPLAY_WAL_INVALID',
      'receipts WAL ends with a torn JSONL line',
      { receiptsFile: path },
    );
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index].trim() === '') {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_INVALID',
        `receipts WAL line ${index + 1} is blank`,
        { receiptsFile: path, lineNumber: index + 1 },
      );
    }
    let record;
    try { record = JSON.parse(lines[index]); } catch {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_INVALID',
        `receipts WAL line ${index + 1} is malformed`,
        { receiptsFile: path, lineNumber: index + 1 },
      );
    }
    if (!WAL_VERSIONS.has(record?.v)) {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_INVALID',
        `receipts WAL line ${index + 1} has unknown version`,
      );
    }
    records.push(record);
  }
  return records;
}

function analyzeWal(records) {
  const dispatches = new Map();
  const dispatchByTransportId = new Map();
  const terminals = new Map();
  const acked = new Set();
  let ambiguous = null;
  let refused = null;
  let projectionOverflow = null;
  let priorDispatchSeq = null;
  const malformed = (message, recordIndex) => codedError(
    'SNAPBACK_REPLAY_WAL_INVALID',
    `${message} at WAL record ${recordIndex + 1}`,
    { recordIndex },
  );
  for (const [recordIndex, record] of records.entries()) {
    if (!plainObject(record)) throw malformed('WAL record must be an object', recordIndex);
    if (record.v === 'snapback.replay-dispatch.v1') {
      if (
        !Number.isSafeInteger(record.seq)
        || record.seq < 0
        || typeof record.intent !== 'string'
        || record.intent.length === 0
        || typeof record.actor !== 'string'
        || record.actor.length === 0
        || typeof record.function !== 'string'
        || record.function.length === 0
        || !(record.selector === null || typeof record.selector === 'string')
        || !plainObject(record.args)
        || !Number.isSafeInteger(record.carrierBytes)
        || record.carrierBytes < 1
        || record.carrierBytes > REPLAY_DISPATCH_CARRIER_MAX_BYTES
        || !['minted', 'none'].includes(record.custody)
        || !(record.transportId === null || (typeof record.transportId === 'string' && record.transportId.length > 0))
        || (record.custody === 'minted') !== (record.transportId !== null)
      ) {
        throw malformed('dispatch carrier is malformed', recordIndex);
      }
      const actualCarrierBytes = Buffer.byteLength(JSON.stringify({
        function: record.function,
        args: record.args,
      }));
      if (record.carrierBytes !== actualCarrierBytes) {
        throw malformed('dispatch carrier byte count does not match its payload', recordIndex);
      }
      if (priorDispatchSeq !== null && record.seq !== priorDispatchSeq + 1) {
        throw malformed(`dispatch sequence gap after ${priorDispatchSeq}`, recordIndex);
      }
      if (refused !== null) {
        throw codedError('SNAPBACK_REPLAY_WAL_INVALID', 'WAL dispatch appears after refused terminal');
      }
      if (ambiguous !== null) {
        throw codedError('SNAPBACK_REPLAY_WAL_INVALID', 'WAL contains more than one open dispatch');
      }
      if (dispatches.has(record.seq)) {
        throw codedError('SNAPBACK_REPLAY_WAL_INVALID', `duplicate dispatch for seq ${record.seq}`);
      }
      if (record.transportId !== null && dispatchByTransportId.has(record.transportId)) {
        throw malformed(`duplicate transport id ${record.transportId}`, recordIndex);
      }
      dispatches.set(record.seq, record);
      if (record.transportId !== null) dispatchByTransportId.set(record.transportId, record);
      priorDispatchSeq = record.seq;
      ambiguous = record;
    } else if (record.v === 'snapback.replay-terminal.v1') {
      if (
        !Number.isSafeInteger(record.seq)
        || !['settled', 'refused'].includes(record.outcome)
        || typeof record.intent !== 'string'
      ) {
        throw malformed('terminal carrier is malformed or has an unknown outcome', recordIndex);
      }
      const dispatch = dispatches.get(record.seq);
      if (dispatch === undefined || terminals.has(record.seq) || ambiguous?.seq !== record.seq) {
        throw codedError('SNAPBACK_REPLAY_WAL_INVALID', `orphan/duplicate terminal for seq ${record.seq}`);
      }
      if (record.intent !== dispatch.intent) {
        throw malformed(`terminal intent does not match dispatch seq ${record.seq}`, recordIndex);
      }
      if (record.outcome === 'settled' && record.code !== null) {
        throw malformed(`settled terminal ${record.seq} carries a refusal code`, recordIndex);
      }
      if (
        record.outcome === 'settled'
        && (
          !plainObject(record.settled)
          || !Number.isSafeInteger(record.retainedBytesCharge)
          || record.retainedBytesCharge < 0
        )
      ) {
        throw malformed(`settled terminal ${record.seq} lacks its settlement carrier`, recordIndex);
      }
      if (
        record.outcome === 'refused'
        && (
          typeof record.code !== 'string'
          || !plainObject(record.diagnostic)
          || record.diagnostic.code !== record.code
          || typeof record.diagnostic.message !== 'string'
          || !plainObject(record.diagnostic.details)
        )
      ) {
        throw malformed(`refused terminal ${record.seq} lacks its exact diagnostic`, recordIndex);
      }
      terminals.set(record.seq, record);
      ambiguous = null;
      if (record.outcome === 'refused') refused = record;
      if (record.settled?.projectionOverflow) projectionOverflow = record;
    } else if (record.v === 'snapback.replay-ack.v1') {
      if (
        typeof record.actor !== 'string'
        || record.actor.length === 0
        || !Array.isArray(record.through)
        || record.through.length === 0
      ) {
        throw codedError('SNAPBACK_REPLAY_WAL_INVALID', 'ack watermark lacks through[]');
      }
      for (const id of record.through) {
        if (typeof id !== 'string' || id.length === 0) {
          throw malformed('ack watermark contains a malformed id', recordIndex);
        }
        const matched = dispatchByTransportId.get(id);
        const terminal = matched === undefined ? undefined : terminals.get(matched.seq);
        if (matched === undefined || terminal?.outcome !== 'settled') {
          throw malformed(`ack watermark id ${id} has no settled dispatch`, recordIndex);
        }
        acked.add(id);
      }
    } else if (record.v === 'snapback.replay-fence.v1') {
      if (record.event !== 'stale-broken' || !plainObject(record.by)) {
        throw malformed('fence record is malformed', recordIndex);
      }
    } else if (record.v === REPLAY_RECEIPT_VERSION) {
      if (record.schemaVersion !== REPLAY_RECEIPT_VERSION || !['passed', 'failed'].includes(record.status)) {
        throw malformed('summary receipt is malformed', recordIndex);
      }
    } else {
      throw malformed('WAL record has an unknown version', recordIndex);
    }
  }
  return Object.freeze({
    dispatches, terminals, acked, ambiguous, refused, projectionOverflow,
  });
}

async function loadModuleFunction(value, names, label) {
  if (value === null || value === false || value === true || typeof value === 'function') return value;
  const loaded = await import(pathToFileURL(value).href);
  for (const name of names) {
    if (typeof loaded[name] === 'function') return loaded[name];
  }
  if (typeof loaded.default === 'function') return loaded.default;
  throw codedError(
    'SNAPBACK_REPLAY_DEFINITION_INVALID',
    `${label} module must export ${names.join(' or ')}`,
    { module: value },
  );
}

async function loadApi(value) {
  if (plainObject(value)) return value;
  const loaded = await import(pathToFileURL(value).href);
  return loaded.default ?? loaded.api ?? loaded;
}

function resolveReference(api, fn, seq) {
  if (plainObject(fn)) return fn;
  if (typeof fn !== 'string' || fn.length === 0) {
    throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `action ${seq} did not resolve a mutation fn`);
  }
  let reference = api;
  for (const member of fn.split('.')) reference = reference?.[member];
  if (!plainObject(reference)) {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `action ${seq} references unknown generated mutation ${fn}`,
      { seq, fn },
    );
  }
  if (reference.kind !== 'Mutation') {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `action ${seq} reference ${fn} is ${reference.kind ?? 'unknown'}, not Mutation`,
      { seq, fn, kind: reference.kind ?? null },
    );
  }
  if (Buffer.byteLength(reference.name ?? fn) > MAX_FUNCTION_NAME_BYTES) {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `action ${seq} function name exceeds the replay retained-byte bound`,
      { seq, maxBytes: MAX_FUNCTION_NAME_BYTES },
    );
  }
  return reference;
}

function findMutationReference(api, name, seen = new Set()) {
  if (!plainObject(api) || seen.has(api)) return null;
  seen.add(api);
  if (api.kind === 'Mutation' && api.name === name) return api;
  for (const value of Object.values(api)) {
    const found = findMutationReference(value, name, seen);
    if (found !== null) return found;
  }
  return null;
}

function resolveDispatchReference(api, dispatch) {
  const reference = typeof dispatch.selector === 'string'
    ? resolveReference(api, dispatch.selector, dispatch.seq)
    : findMutationReference(api, dispatch.function);
  if (reference === null || reference.name !== dispatch.function) {
    throw codedError(
      'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
      `recorded function ${dispatch.function} is unavailable at seq ${dispatch.seq}`,
      { seq: dispatch.seq, function: dispatch.function },
    );
  }
  return reference;
}

function resolvedDispatchCarrier(mapped, reference, position) {
  if (!plainObject(mapped.args)) {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `resolved args at seq ${mapped.seq} must be an object`,
      { position },
    );
  }
  let encoded;
  try {
    encoded = JSON.stringify({ function: reference.name, args: mapped.args });
  } catch (error) {
    throw codedError(
      'SNAPBACK_REPLAY_ACTION_INVALID',
      `resolved dispatch carrier at seq ${mapped.seq} is not JSON-safe`,
      { position, cause: String(error) },
    );
  }
  const bytes = Buffer.byteLength(encoded);
  if (bytes > REPLAY_DISPATCH_CARRIER_MAX_BYTES) {
    throw codedError(
      'SNAPBACK_REPLAY_DISPATCH_CARRIER_TOO_LARGE',
      `resolved dispatch carrier exceeds ${REPLAY_DISPATCH_CARRIER_MAX_BYTES} bytes`,
      { position, bytes, maxBytes: REPLAY_DISPATCH_CARRIER_MAX_BYTES },
    );
  }
  const parsed = JSON.parse(encoded);
  return Object.freeze({
    function: parsed.function,
    selector: typeof mapped.fn === 'string' ? mapped.fn : null,
    args: Object.freeze(parsed.args),
    bytes,
  });
}

function readyDescriptor(path) {
  let ready;
  try { ready = JSON.parse(readFileSync(path, 'utf8')); } catch (error) {
    throw codedError(
      'SNAPBACK_REPLAY_READY_INVALID',
      `ready descriptor could not be read at ${path}`,
      { cause: error?.code ?? String(error) },
    );
  }
  if (ready?.ready !== true || typeof ready.serverUrl !== 'string') {
    throw codedError('SNAPBACK_REPLAY_READY_INVALID', 'ready descriptor is not application-ready');
  }
  return ready;
}

function privateJson(path, expectedVersion) {
  if (!existsSync(path)) return null;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw codedError(
      'SNAPBACK_REPLAY_SESSION_CUSTODY_INVALID',
      `session custody file must be owner-only (mode 0600): ${path}`,
      { mode: mode.toString(8) },
    );
  }
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw codedError(
      'SNAPBACK_REPLAY_SESSION_CUSTODY_INVALID',
      `session custody file is not valid JSON: ${path}`,
      { cause: String(error) },
    );
  }
  if (value?.v !== expectedVersion) {
    throw codedError('SNAPBACK_REPLAY_SESSION_CUSTODY_INVALID', 'session custody version is invalid');
  }
  return value;
}

async function captureChild(child, signal = null) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-MAX_CHILD_OUTPUT_BYTES); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-MAX_CHILD_OUTPUT_BYTES); });
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const exit = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code, exitSignal) => resolveExit({ code, signal: exitSignal }));
    });
    return { ...exit, stdout, stderr };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}

async function mintSession(definition, ready, actor, emailFor, custody, signal) {
  if (typeof ready.adminTokenFile !== 'string') {
    throw codedError(
      'SNAPBACK_REPLAY_SESSION_CUSTODY_UNAVAILABLE',
      'minted replay requires ready.adminTokenFile',
      { actor },
    );
  }
  const email = emailFor === null
    ? `${encodeURIComponent(actor)}@replay.invalid`
    : await emailFor(actor);
  if (typeof email !== 'string' || email.length === 0) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'emailFor must return a non-empty email');
  }
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const executable = process.env.SNAPBACK_RUNTIME_BINARY ?? 'snapback';
  const child = spawn(executable, [
    'session', 'mint', '--email', email, '--ready-file', definition.readyFile,
  ], {
    cwd: dirname(definition.readyFile),
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = await captureChild(child, signal);
  let envelope = null;
  try { envelope = JSON.parse(exit.stdout); } catch {}
  const token = envelope?.data?.token ?? envelope?.bearer ?? null;
  if (exit.code !== 0 || envelope?.ok !== true || typeof token !== 'string') {
    const diagnosticCodes = Array.isArray(envelope?.diagnostics)
      ? envelope.diagnostics
        .map((diagnostic) => diagnostic?.code)
        .filter((code) => typeof code === 'string' && /^SNAPBACK_[A-Z0-9_]+$/u.test(code))
        .slice(0, 8)
      : [];
    throw codedError(
      'SNAPBACK_REPLAY_SESSION_MINT_FAILED',
      `session mint failed for actor ${actor}; child output was redacted`, {
      actor,
      exitCode: exit.code,
      exitSignal: exit.signal,
      diagnosticCodes,
    });
  }
  custody.actors[actor] = { email, token, mintedAt: Date.now() };
  writePrivateJson(definition.sessionCustodyFile, custody);
  return token;
}

function normalizeDiagnostic(error, position = null) {
  const diagnostic = plainObject(error?.diagnostic) ? error.diagnostic : null;
  const code = diagnostic?.code ?? error?.code ?? 'SNAPBACK_REPLAY_FAILED';
  const originalMessage = diagnostic?.message ?? error?.message ?? String(error);
  return Object.freeze({
    ...(diagnostic ?? {}),
    code,
    message: originalMessage,
    details: plainObject(diagnostic?.details)
      ? diagnostic.details
      : plainObject(error?.details) ? error.details : {},
    ...(position === null ? {} : { position }),
  });
}

function definiteRefusal(error) {
  const code = error?.diagnostic?.code ?? error?.code;
  if (typeof code !== 'string' || !code.startsWith('SNAPBACK_')) return false;
  const replayDiagnosticPrefix = ['SNAPBACK', 'REPLAY', ''].join('_');
  if (code.startsWith(replayDiagnosticPrefix)) return false;
  if (error?.effectMayHaveCommitted === true) return false;
  const status = error?.diagnostic?.details?.httpStatus ?? error?.status ?? null;
  return plainObject(error?.diagnostic)
    || (Number.isInteger(status) && status >= 400 && status < 500);
}

function generatedIds(value, path = [], output = {}, state = { count: 0 }) {
  const depth = path.length;
  if (depth > 12 || state.count > 2_048 || value === null) return output;
  if (typeof value === 'string') {
    const key = path.at(-1) ?? '';
    if (key === 'id' || key === '_id' || key.endsWith('Id')) {
      output[path.join('.')] = value;
      state.count += 1;
    }
    return output;
  }
  if (Array.isArray(value)) {
    const key = path.at(-1) ?? '';
    if (key === 'ids' && value.every((entry) => typeof entry === 'string')) {
      output[path.join('.')] = [...value];
      state.count += value.length;
      return output;
    }
    for (let index = 0; index < value.length; index += 1) {
      generatedIds(value[index], [...path, String(index)], output, state);
    }
  } else if (plainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      generatedIds(entry, [...path, key], output, state);
    }
  }
  return output;
}

function validateProjection(value, maxBytes) {
  let json;
  try { json = JSON.stringify(value); } catch (error) {
    throw codedError('SNAPBACK_REPLAY_PROJECTION_INVALID', 'settlement projection is not JSON-safe', {
      cause: String(error),
    });
  }
  if (json === undefined) {
    throw codedError('SNAPBACK_REPLAY_PROJECTION_INVALID', 'settlement projection is undefined');
  }
  const bytes = Buffer.byteLength(json);
  return Object.freeze({ value, bytes, overflow: bytes > maxBytes });
}

function preflight(definition, actionInfo, resumeEligible, authorityPlan = null) {
  const maximumCharge = REPLAY_CEILINGS.retainedMutationResultBytes
    + REPLAY_RETAINED_ROW_OVERHEAD_BYTES;
  const unsafe = [];
  if (definition.acknowledgeEvery > REPLAY_CEILINGS.retainedMutationRecordsPerAuthority) {
    unsafe.push('acknowledgeEvery exceeds the per-authority retained-record ceiling');
  }
  if (
    definition.acknowledgeBytes + maximumCharge
    > REPLAY_CEILINGS.retainedMutationBytesPerAuthority
  ) {
    unsafe.push('acknowledgeBytes plus one maximum settlement exceeds the retained-byte ceiling');
  }
  const report = Object.freeze({
    schemaVersion: 'snapback.replay-preflight.v1',
    actions: actionInfo.total,
    resumeEligible,
    acknowledgeWindow: Object.freeze({
      count: definition.acknowledgeEvery,
      bytes: definition.acknowledgeBytes,
      maximumSettlementCharge: maximumCharge,
    }),
    custody: Object.freeze({
      requested: definition.transportCustody,
      generatedIrReferences: actionInfo.generatedIrReferences,
      deferredMapperActions: actionInfo.deferredMapperActions,
    }),
    authorityComposition: authorityPlan,
    advisories: Object.freeze(definition.actors.kind === 'bearer' ? [Object.freeze({
      code: 'SNAPBACK_REPLAY_BEARER_RETENTION_UNKNOWN',
      message: 'bearerFor authority may already own retained settlements that replay preflight cannot inspect',
    })] : []),
    ceilings: Object.freeze([
      Object.freeze({
        code: 'SNAPBACK_CLIENT_MUTATION_RETENTION_FULL',
        recordsPerAuthority: REPLAY_CEILINGS.retainedMutationRecordsPerAuthority,
        bytesPerAuthority: REPLAY_CEILINGS.retainedMutationBytesPerAuthority,
        resultBytes: REPLAY_CEILINGS.retainedMutationResultBytes,
      }),
      Object.freeze({ code: 'SNAPBACK_RELATIONAL_PLAN_INVALID', rows: REPLAY_CEILINGS.queryTakeRows }),
      Object.freeze({
        code: 'SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED',
        writes: REPLAY_CEILINGS.bufferedMutationWrites,
        guidance: 'keep batch-ingest actions at or below 900 direct rows',
      }),
      Object.freeze({ code: 'SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED', effects: REPLAY_CEILINGS.seedEffects }),
    ]),
    unsafe: Object.freeze(unsafe),
  });
  if (actionInfo.generatedIrReferences > 0) {
    throw codedError(
      'SNAPBACK_REPLAY_GENERATED_IR_UNSUPPORTED',
      'v1 replay refuses generated-IR mutations because retry preparation mints fresh speculative identity',
      { preflight: report, generatedIrReferences: actionInfo.generatedIrReferences },
    );
  }
  if (unsafe.length > 0) {
    throw codedError(
      'SNAPBACK_REPLAY_ACK_WINDOW_UNSAFE',
      `replay refuses before dispatch: ${unsafe.join('; ')}`,
      { preflight: report },
    );
  }
  return report;
}

class ReplayClientPool {
  constructor(definition, ready, actors, signal) {
    this.definition = definition;
    this.ready = ready;
    this.actors = actors;
    this.signal = signal;
    this.entries = new Map();
    this.bearers = new Map();
    this.clock = 0;
    this.maximumObserved = 0;
    this.emailFor = null;
    this.bearerFor = null;
    this.custody = actors.kind === 'mint'
      ? privateJson(definition.sessionCustodyFile, 'snapback.replay-session-custody.v1')
        ?? { v: 'snapback.replay-session-custody.v1', readyFile: definition.readyFile, actors: {} }
      : null;
  }

  async initialize() {
    this.emailFor = this.actors.kind === 'mint'
      ? await loadModuleFunction(this.actors.emailFor, ['emailFor'], 'actors.mint.emailFor')
      : null;
    this.bearerFor = this.actors.kind === 'bearer'
      ? await loadModuleFunction(this.actors.bearerFor, ['bearerFor'], 'actors.bearerFor')
      : null;
  }

  async token(actor, { requireExisting = false } = {}) {
    if (this.bearers.has(actor)) return this.bearers.get(actor);
    let token;
    if (this.actors.kind === 'bearer') {
      token = await this.bearerFor(actor);
    } else {
      token = this.custody.actors?.[actor]?.token ?? null;
      if (token === null && requireExisting) {
        throw codedError(
          'SNAPBACK_REPLAY_SESSION_CUSTODY_UNAVAILABLE',
          `session custody for ambiguous actor ${actor} is missing`,
          { actor, sessionCustodyFile: this.definition.sessionCustodyFile },
        );
      }
      if (token === null) {
        token = await mintSession(
          this.definition,
          this.ready,
          actor,
          this.emailFor,
          this.custody,
          this.signal,
        );
      }
    }
    if (typeof token !== 'string' || token.length === 0) {
      throw codedError(
        'SNAPBACK_REPLAY_SESSION_CUSTODY_UNAVAILABLE',
        `bearerFor returned no authority for actor ${actor}`,
        { actor },
      );
    }
    this.bearers.set(actor, token);
    return token;
  }

  async authorityFingerprint(actor, options = {}) {
    const token = await this.token(actor, options);
    return `sha256:${createHash('sha256').update(token).digest('hex')}`;
  }

  async preflightAuthorityPlan(actors) {
    const groups = new Map();
    for (const actor of actors) {
      let fingerprint;
      if (this.actors.kind === 'bearer') {
        fingerprint = await this.authorityFingerprint(actor);
      } else {
        const retained = this.custody.actors?.[actor]?.token ?? null;
        fingerprint = retained === null
          ? `fresh-minted-actor:${actor}`
          : `sha256:${createHash('sha256').update(retained).digest('hex')}`;
      }
      groups.set(fingerprint, (groups.get(fingerprint) ?? 0) + 1);
    }
    return Object.freeze({
      actors: actors.length,
      authFingerprints: groups.size,
      largestAliasedActorCount: groups.size === 0 ? 0 : Math.max(...groups.values()),
      windowComposition: 'per-auth-fingerprint',
    });
  }

  async client(actor, options = {}) {
    const existing = this.entries.get(actor);
    if (existing !== undefined) {
      existing.used = ++this.clock;
      return existing.client;
    }
    if (this.entries.size >= this.definition.clientPool) {
      const evicted = [...this.entries.entries()].sort((left, right) => left[1].used - right[1].used)[0];
      this.entries.delete(evicted[0]);
      await evicted[1].client.close();
    }
    const bearerToken = await this.token(actor, options);
    const { createExternalSessionClient } = await import('@expo/snapback-client');
    const clientStoreId = `replay-${createHash('sha256').update(actor).digest('hex').slice(0, 24)}`;
    const client = createExternalSessionClient(this.ready.serverUrl, {
      bearerToken,
      clientStoreId,
      rqsStore: null,
      offlineQueue: false,
    });
    this.entries.set(actor, { client, used: ++this.clock });
    this.maximumObserved = Math.max(this.maximumObserved, this.entries.size);
    return client;
  }

  async close() {
    let first = null;
    for (const { client } of this.entries.values()) {
      try { await client.close(); } catch (error) { first ??= error; }
    }
    this.entries.clear();
    if (first !== null) throw first;
  }
}

function serializableDefinition(definition) {
  const offending = [];
  if (typeof definition.api !== 'string') offending.push('api');
  if (typeof definition.actions !== 'string') offending.push('actions');
  for (const field of ['mapper', 'settlementProjection', 'idempotent']) {
    if (typeof definition[field] === 'function') offending.push(field);
  }
  if (definition.actors.kind === 'bearer' && typeof definition.actors.bearerFor === 'function') {
    offending.push('actors.bearerFor');
  }
  if (definition.actors.kind === 'mint' && typeof definition.actors.emailFor === 'function') {
    offending.push('actors.mint.emailFor');
  }
  if (offending.length > 0) {
    throw codedError(
      'SNAPBACK_REPLAY_DETACH_NOT_SERIALIZABLE',
      `detached replay cannot serialize: ${offending.join(', ')}`,
      { offending },
    );
  }
  return {
    readyFile: definition.readyFile,
    api: definition.api,
    actions: definition.actions,
    actors: definition.actors.kind === 'mint'
      ? { mint: { ...(definition.actors.emailFor === null ? {} : { emailFor: definition.actors.emailFor }) } }
      : { bearerFor: definition.actors.bearerFor },
    clientPool: definition.clientPool,
    transportCustody: definition.transportCustody,
    acknowledgeEvery: definition.acknowledgeEvery,
    acknowledgeBytes: definition.acknowledgeBytes,
    receiptsFile: definition.receiptsFile,
    statusFile: definition.statusFile,
    sessionCustodyFile: definition.sessionCustodyFile,
    settlementProjectionBytes: definition.settlementProjectionBytes,
    checkpointCadenceMs: definition.checkpointCadenceMs,
    ...(definition.mapper === null ? {} : { mapper: definition.mapper }),
    ...(definition.settlementProjection === null
      ? {}
      : { settlementProjection: definition.settlementProjection }),
    ...(definition.idempotent === false ? {} : { idempotent: definition.idempotent }),
  };
}

async function detachReplay(definition, options) {
  const offendingOptions = [];
  if (options.signal !== undefined) offendingOptions.push('signal');
  if (options.onPreflight !== undefined) offendingOptions.push('onPreflight');
  if (offendingOptions.length > 0) {
    throw codedError(
      'SNAPBACK_REPLAY_DETACH_NOT_SERIALIZABLE',
      `detached replay cannot serialize: ${offendingOptions.join(', ')}`,
      { offending: offendingOptions },
    );
  }
  resumeMode(options.resume);
  const detachedDefinition = serializableDefinition(definition);
  const configFile = `${definition.statusFile}.definition.json`;
  const worker = fileURLToPath(new URL('./replay-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [worker, configFile], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const barrier = new Promise((resolveBarrier, rejectBarrier) => {
    let finished = false;
    const finish = (value, error = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.removeListener('message', onMessage);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      if (error === null) resolveBarrier(value); else rejectBarrier(error);
    };
    const onError = (error) => finish(null, error);
    const onExit = (code, signal) => finish(null, codedError(
      'SNAPBACK_REPLAY_DETACH_CONFIG_INVALID',
      'detached replay worker exited before the fence/config barrier completed',
      { exitCode: code, exitSignal: signal },
    ));
    const onMessage = (message) => {
      if (message?.v === 'snapback.replay-worker-fenced.v1') {
        // The child owns the WAL fence now. Only after that ownership is
        // observable may the parent publish shared detached configuration.
        writePrivateJson(configFile, {
          v: 'snapback.replay-detached-definition.v1',
          definition: detachedDefinition,
          resume: options.resume ?? false,
        });
        child.send({ v: 'snapback.replay-worker-start.v1' });
      } else if (message?.v === 'snapback.replay-worker-started.v1') {
        finish({ ok: true });
      } else if (message?.v === 'snapback.replay-worker-failed.v1') {
        finish({ ok: false, diagnostic: message.diagnostic });
      }
    };
    const timeout = setTimeout(() => finish(null, codedError(
      'SNAPBACK_REPLAY_DETACH_CONFIG_INVALID',
      'detached replay worker did not complete its fence/config barrier',
    )), 15_000);
    child.on('message', onMessage);
    child.once('error', onError);
    child.once('exit', onExit);
    child.send({
      v: 'snapback.replay-worker-prepare.v1',
      receiptsFile: definition.receiptsFile,
      statusFile: definition.statusFile,
    });
  });
  let barrierResult;
  try {
    barrierResult = await barrier;
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  if (child.connected) child.disconnect();
  child.unref();
  if (!barrierResult.ok) {
    const receipt = Object.freeze({
      schemaVersion: REPLAY_RECEIPT_VERSION,
      status: 'failed',
      pid: child.pid,
      statusFile: definition.statusFile,
      receiptsFile: definition.receiptsFile,
      diagnostic: barrierResult.diagnostic,
    });
    return Object.freeze({ receipt, exitCode: 1 });
  }
  const receipt = Object.freeze({
    schemaVersion: REPLAY_RECEIPT_VERSION,
    status: 'detached',
    pid: child.pid,
    statusFile: definition.statusFile,
    receiptsFile: definition.receiptsFile,
  });
  return Object.freeze({ receipt, exitCode: 0 });
}

function resumeMode(value) {
  if (value === true) return Object.freeze({ enabled: true, ambiguous: 'stop' });
  if (value === false || value === undefined) return Object.freeze({ enabled: false, ambiguous: 'stop' });
  if (plainObject(value) && value.ambiguous === 'reexecute') {
    return Object.freeze({ enabled: true, ambiguous: 'reexecute' });
  }
  throw codedError(
    'SNAPBACK_REPLAY_DEFINITION_INVALID',
    "resume must be boolean or {ambiguous:'reexecute'}",
  );
}

function actionPosition(action, fn) {
  return Object.freeze({
    seq: action.seq,
    intent: action.intent,
    actor: action.actor,
    fn: typeof action.fn === 'string' ? action.fn : fn?.name ?? 'mutation',
  });
}

function dispatchSourceMatches(action, dispatch) {
  return dispatch.seq === action.seq
    && dispatch.intent === action.intent
    && dispatch.actor === action.actor;
}

function directActionMatchesDispatch(action, dispatch, reference) {
  if (!dispatchSourceMatches(action, dispatch) || reference.name !== dispatch.function) return false;
  try {
    return JSON.stringify(action.args ?? {}) === JSON.stringify(dispatch.args);
  } catch {
    return false;
  }
}

async function validateWalPrefix(source, wal, api, mapperOwned = false) {
  const seen = new Set();
  let previousSeq = null;
  for await (const { value } of jsonlRecords(source.path)) {
    const action = normalizeAction(value, previousSeq);
    previousSeq = action.seq;
    const dispatch = wal.dispatches.get(action.seq);
    if (dispatch === undefined) continue;
    seen.add(action.seq);
    if (mapperOwned || action.fn === undefined) {
      if (!dispatchSourceMatches(action, dispatch)) {
        throw codedError(
          'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
          `mapped action log identity differs from WAL at seq ${action.seq}`,
          { action: { seq: action.seq, actor: action.actor, intent: action.intent }, dispatch },
        );
      }
      continue;
    }
    const reference = resolveReference(api, action.fn, action.seq);
    if (!directActionMatchesDispatch(action, dispatch, reference)) {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
        `action log differs from WAL at seq ${action.seq}`,
        { action: actionPosition(action, reference), dispatch },
      );
    }
  }
  for (const seq of wal.dispatches.keys()) {
    if (!seen.has(seq)) {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
        `WAL seq ${seq} is absent from the re-read action source`,
        { seq },
      );
    }
  }
}

function pagedQuery(client, api) {
  return async (queryRef, queryOptions = {}) => {
    const resolved = typeof queryRef === 'string'
      ? queryRef.split('.').reduce((value, key) => value?.[key], api)
      : queryRef;
    if (!plainObject(resolved) || !['Query', 'LiveQuery'].includes(resolved.kind)) {
      throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', 'ctx.query requires a generated query reference');
    }
    const pageSize = Math.min(
      positiveInteger(queryOptions.pageSize ?? REPLAY_CEILINGS.queryTakeRows, 'ctx.query.pageSize'),
      REPLAY_CEILINGS.queryTakeRows,
    );
    const cursorKey = queryOptions.cursorKey ?? 'after';
    const pageSizeKey = queryOptions.pageSizeKey ?? 'limit';
    const rows = [];
    let cursor = null;
    let pages = 0;
    let version = null;
    const seenCursors = new Set();
    do {
      const output = await client.query(resolved, {
        args: {
          ...(queryOptions.args ?? {}),
          [pageSizeKey]: pageSize,
          ...(cursor === null ? {} : { [cursorKey]: cursor }),
        },
      });
      if (!Array.isArray(output.rows)) {
        throw codedError('SNAPBACK_REPLAY_QUERY_PAGE_INVALID', 'paged query did not return rows[]');
      }
      rows.push(...output.rows);
      pages += 1;
      version = output.version;
      cursor = output.cursor ?? null;
      if (cursor !== null && seenCursors.has(cursor)) {
        throw codedError('SNAPBACK_REPLAY_QUERY_PAGE_INVALID', 'paged query repeated a cursor');
      }
      if (cursor !== null) seenCursors.add(cursor);
    } while (cursor !== null);
    return Object.freeze({ rows: Object.freeze(rows), pages, version });
  };
}

function chargeForResult(result) {
  return Buffer.byteLength(JSON.stringify(result ?? null)) + REPLAY_RETAINED_ROW_OVERHEAD_BYTES;
}

async function idempotentAction(predicate, action) {
  if (predicate === true) return true;
  if (predicate === false || predicate === null) return false;
  return Boolean(await predicate(action));
}

async function runAttached(definition, options) {
  const resume = resumeMode(options.resume);
  const source = await spoolActionSource(definition);
  let fence = options.preacquiredFence ?? null;
  let fenceAcquired = fence !== null;
  let pool = null;
  let heartbeat = null;
  let failure = null;
  let preflightReport = null;
  let wal = null;
  let forceAcknowledgeAll = null;
  const progress = {
    settled: 0,
    failed: 0,
    skipped: 0,
    acknowledged: 0,
    duplicatePossible: 0,
    lastSeq: null,
    total: null,
  };
  const outstanding = new Map();
  const settledByIntent = new Map();
  try {
    if (fence === null) {
      fence = acquireFence(definition.receiptsFile);
      fenceAcquired = true;
    }
    await options.onFenceAcquired?.(fence);
    if (resume.enabled && !source.resumeEligible) {
      throw codedError(
        'SNAPBACK_REPLAY_ACTION_SOURCE_NOT_RESUMABLE',
        'resume requires a re-readable file-backed action source',
      );
    }
    const api = await loadApi(definition.api);
    const actionInfo = await inspectActions(source, api);
    progress.total = actionInfo.total;
    const records = readWal(definition.receiptsFile);
    if (!resume.enabled && records.some((record) => (
      record.v === 'snapback.replay-dispatch.v1' || record.v === 'snapback.replay-terminal.v1'
    ))) {
      throw codedError(
        'SNAPBACK_REPLAY_WAL_EXISTS',
        'receipts WAL already contains actions; pass resume:true or select a new file',
      );
    }
    wal = analyzeWal(records);
    progress.duplicatePossible = [...wal.terminals.values()]
      .filter((terminal) => terminal.ambiguity === 'duplicate-possible').length;
    await validateWalPrefix(source, wal, api, definition.mapper !== null);
    // A refused terminal is final and carries no settlement to drain. Return
    // its recorded diagnostic before consulting mutable ready/auth state so a
    // later environment failure cannot replace the original refusal.
    if (wal.refused !== null) {
      throw Object.assign(new Error(wal.refused.diagnostic.message), {
        code: wal.refused.diagnostic.code,
        diagnostic: wal.refused.diagnostic,
      });
    }
    if (actionInfo.generatedIrReferences > 0) {
      preflight(definition, actionInfo, source.resumeEligible);
    }
    const ready = readyDescriptor(definition.readyFile);
    const mapper = await loadModuleFunction(definition.mapper, ['mapper', 'mapAction'], 'mapper');
    const projection = await loadModuleFunction(
      definition.settlementProjection,
      ['settlementProjection', 'projectSettlement'],
      'settlementProjection',
    );
    const idempotent = await loadModuleFunction(definition.idempotent, ['idempotent'], 'idempotent');
    pool = new ReplayClientPool(definition, ready, definition.actors, options.signal ?? null);
    await pool.initialize();
    const authorityPlan = await pool.preflightAuthorityPlan(actionInfo.actors);
    preflightReport = preflight(definition, actionInfo, source.resumeEligible, authorityPlan);
    await options.onPreflight?.(preflightReport);

    const status = (state = 'running', extra = {}) => writeStatus(definition, {
      state,
      settled: progress.settled,
      failed: progress.failed,
      total: progress.total,
      lastSeq: progress.lastSeq,
      pid: process.pid,
      ...extra,
    });
    status();
    heartbeat = setInterval(() => status(), definition.checkpointCadenceMs);
    heartbeat.unref?.();

    const acknowledge = async (fingerprint, bucket) => {
      if (bucket.entries.length === 0) return;
      const client = await pool.client(bucket.actor, { requireExisting: resume.enabled });
      const ids = bucket.entries.map((entry) => entry.transportId);
      await client.acknowledgeMutations({ clientMutationIds: ids });
      appendWal(definition.receiptsFile, {
        v: 'snapback.replay-ack.v1',
        actor: bucket.actor,
        through: ids,
        at: Date.now(),
      });
      progress.acknowledged += ids.length;
      outstanding.delete(fingerprint);
    };
    const maybeAcknowledge = async (fingerprint, force = false) => {
      const bucket = outstanding.get(fingerprint) ?? { actor: null, entries: [] };
      const bytes = bucket.entries.reduce((sum, entry) => sum + entry.retainedBytesCharge, 0);
      if (
        force
        || bucket.entries.length >= definition.acknowledgeEvery
        || bytes >= definition.acknowledgeBytes
      ) await acknowledge(fingerprint, bucket);
    };
    forceAcknowledgeAll = async () => {
      for (const fingerprint of [...outstanding.keys()]) await maybeAcknowledge(fingerprint, true);
    };
    const addOutstanding = async (actor, entry, { requireExisting = false } = {}) => {
      const fingerprint = await pool.authorityFingerprint(actor, { requireExisting });
      const bucket = outstanding.get(fingerprint) ?? { actor, entries: [] };
      bucket.entries.push(entry);
      outstanding.set(fingerprint, bucket);
      return fingerprint;
    };

    for (const dispatch of wal.dispatches.values()) {
      const terminal = wal.terminals.get(dispatch.seq);
      if (terminal?.outcome === 'settled') {
        progress.skipped += 1;
        progress.settled += 1;
        progress.lastSeq = dispatch.seq;
        settledByIntent.set(dispatch.intent, terminal.settled);
      }
      if (
        terminal?.outcome === 'settled'
        && dispatch.transportId !== null
        && !wal.acked.has(dispatch.transportId)
      ) {
        await addOutstanding(dispatch.actor, {
          transportId: dispatch.transportId,
          retainedBytesCharge: terminal.retainedBytesCharge ?? chargeForResult(null),
        }, { requireExisting: resume.enabled && definition.actors.kind === 'mint' });
      }
    }
    // @ref LLP 0307.000#d7-failure-semantics-and-resume — only terminal-lined
    // ids enter the cross-run drain; the crash-ambiguous id remains retained.
    await forceAcknowledgeAll();

    if (wal.projectionOverflow !== null) {
      throw codedError(
        'SNAPBACK_REPLAY_PROJECTION_TOO_LARGE',
        `resume stops at projection-overflow settlement seq ${wal.projectionOverflow.seq}`,
        { terminal: wal.projectionOverflow },
      );
    }

    let previousSeq = null;
    let ambiguousResolved = wal.ambiguous === null;
    for await (const { value } of jsonlRecords(source.path)) {
      const raw = normalizeAction(value, previousSeq);
      previousSeq = raw.seq;
      const priorDispatch = wal.dispatches.get(raw.seq) ?? null;
      const priorTerminal = wal.terminals.get(raw.seq) ?? null;
      let client = null;
      let mapped;
      let reference;
      let carrier;
      if (priorDispatch !== null) {
        if (!dispatchSourceMatches(raw, priorDispatch)) {
          throw codedError(
            'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
            `action log differs from WAL at seq ${raw.seq}`,
            { action: { seq: raw.seq, actor: raw.actor, intent: raw.intent }, dispatch: priorDispatch },
          );
        }
        reference = resolveDispatchReference(api, priorDispatch);
        mapped = Object.freeze({
          ...raw,
          fn: priorDispatch.selector ?? priorDispatch.function,
          args: priorDispatch.args,
        });
        carrier = Object.freeze({
          function: priorDispatch.function,
          selector: priorDispatch.selector ?? null,
          args: priorDispatch.args,
          bytes: priorDispatch.carrierBytes,
        });
        // Terminal- and dispatch-lined actions consume only their recorded
        // carrier. In particular, mapper code and ctx.query never run again.
        if (priorTerminal !== null) continue;
      } else {
        if (!ambiguousResolved) {
          throw codedError(
            'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
            `WAL ambiguous seq ${wal.ambiguous.seq} is absent from the action prefix`,
          );
        }
        client = await pool.client(raw.actor);
        const baseContext = {
          action: raw,
          settled(intent) { return settledByIntent.get(intent) ?? null; },
          query: pagedQuery(client, api),
        };
        mapped = mapper === null ? raw : await mapper(Object.freeze(baseContext));
        if (!plainObject(mapped)) {
          throw codedError('SNAPBACK_REPLAY_ACTION_INVALID', `mapper returned no action at seq ${raw.seq}`);
        }
        mapped = Object.freeze({ ...raw, ...mapped, seq: raw.seq, actor: raw.actor, intent: raw.intent });
        reference = resolveReference(api, mapped.fn, mapped.seq);
      }
      const position = Object.freeze({ ...actionPosition(mapped, reference), fn: reference.name });
      if (reference.mutationIr?.format === 'snapback.generated-mutation-ir.v1') {
        throw codedError(
          'SNAPBACK_REPLAY_GENERATED_IR_UNSUPPORTED',
          'v1 replay refuses generated-IR mutations because retry preparation mints fresh speculative identity',
          { position, phase: 'action-preflight' },
        );
      }
      if (carrier === undefined) carrier = resolvedDispatchCarrier(mapped, reference, position);
      if (priorDispatch === null && !ambiguousResolved) {
        throw codedError(
          'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
          `WAL ambiguous seq ${wal.ambiguous.seq} is absent from the action prefix`,
        );
      }

      const effectiveCustody = priorDispatch?.custody ?? definition.transportCustody;
      let transportId = priorDispatch?.transportId ?? null;
      let duplicatePossible = false;
      if (priorDispatch !== null && transportId === null) {
        const optIn = resume.ambiguous === 'reexecute' || await idempotentAction(idempotent, mapped);
        if (!optIn) {
          throw codedError(
            'SNAPBACK_REPLAY_AMBIGUOUS_NONE',
            `resume stops at crash-ambiguous custody:none action ${mapped.seq}`,
            { position },
          );
        }
        duplicatePossible = true;
        progress.duplicatePossible += 1;
      }
      if (priorDispatch === null && effectiveCustody !== 'none') {
        transportId = `rp-${randomUUID()}`;
      }
      client ??= await pool.client(raw.actor, {
        requireExisting: priorDispatch !== null
          && transportId !== null
          && definition.actors.kind === 'mint',
      });
      if (options.signal?.aborted) {
        throw codedError('SNAPBACK_REPLAY_INTERRUPTED', 'replay stopped at an action boundary', {
          position,
        });
      }
      if (priorDispatch === null) {
        appendWal(definition.receiptsFile, {
          v: 'snapback.replay-dispatch.v1',
          seq: mapped.seq,
          intent: mapped.intent,
          actor: mapped.actor,
          function: carrier.function,
          selector: carrier.selector,
          args: carrier.args,
          carrierBytes: carrier.bytes,
          custody: effectiveCustody,
          transportId,
          at: Date.now(),
        });
      }
      const startedAt = Date.now();
      try {
        const outcome = await client.mutate(reference, {
          args: carrier.args,
          clientMutationId: transportId,
          queue: false,
        });
        if (outcome?.status !== 'settled') {
          throw codedError('SNAPBACK_REPLAY_MUTATION_NOT_SETTLED', 'mutation did not settle synchronously');
        }
        const projected = validateProjection(
          projection === null
            ? { ids: generatedIds(outcome.result) }
            : await projection(outcome.result, mapped, outcome),
          definition.settlementProjectionBytes,
        );
        const retainedBytesCharge = effectiveCustody === 'none'
          ? 0
          : chargeForResult(outcome.result);
        const terminal = {
          v: 'snapback.replay-terminal.v1',
          seq: mapped.seq,
          intent: mapped.intent,
          outcome: 'settled',
          code: null,
          version: outcome.version,
          settled: projected.overflow
            ? {
              ids: null,
              projectionOverflow: {
                bytes: projected.bytes,
                maxBytes: definition.settlementProjectionBytes,
              },
            }
            : projected.value,
          retainedBytesCharge,
          ms: Date.now() - startedAt,
          at: Date.now(),
          ...(duplicatePossible ? { ambiguity: 'duplicate-possible' } : {}),
        };
        appendWal(definition.receiptsFile, terminal);
        if (wal.ambiguous?.seq === mapped.seq) ambiguousResolved = true;
        progress.settled += 1;
        progress.lastSeq = mapped.seq;
        settledByIntent.set(mapped.intent, terminal.settled);
        if (transportId !== null) {
          const fingerprint = await addOutstanding(mapped.actor, { transportId, retainedBytesCharge });
          // ACK flushing is deliberately outside the mutation/refusal catch.
          // A flush error after this terminal must never manufacture a second
          // terminal for the already-settled sequence.
          await maybeAcknowledge(fingerprint);
        }
        status();
        if (projected.overflow) throw codedError(
          'SNAPBACK_REPLAY_PROJECTION_TOO_LARGE',
          `settlement projection exceeded ${definition.settlementProjectionBytes} bytes`,
          { position, bytes: projected.bytes, maxBytes: definition.settlementProjectionBytes },
        );
      } catch (error) {
        if (error?.code === 'SNAPBACK_REPLAY_PROJECTION_TOO_LARGE') throw error;
        const alreadySettled = wal.terminals.has(mapped.seq) || readWal(definition.receiptsFile).some((record) => (
          record.v === 'snapback.replay-terminal.v1'
          && record.seq === mapped.seq
          && record.outcome === 'settled'
        ));
        if (alreadySettled) throw error;
        if (priorDispatch !== null && transportId !== null && String(error?.code ?? '').startsWith('SNAPBACK_AUTH_')) {
          throw codedError(
            'SNAPBACK_REPLAY_SESSION_CUSTODY_UNAVAILABLE',
            `saved authority could not resolve ambiguous action ${mapped.seq}`,
            { position, cause: normalizeDiagnostic(error, position) },
          );
        }
        if (!definiteRefusal(error)) throw error;
        const diagnostic = normalizeDiagnostic(error, position);
        appendWal(definition.receiptsFile, {
          v: 'snapback.replay-terminal.v1',
          seq: mapped.seq,
          intent: mapped.intent,
          outcome: 'refused',
          code: diagnostic.code,
          diagnostic,
          ms: Date.now() - startedAt,
          at: Date.now(),
        });
        progress.failed += 1;
        progress.lastSeq = mapped.seq;
        throw Object.assign(new Error(diagnostic.message), {
          code: diagnostic.code,
          diagnostic,
        });
      }
    }
    if (!ambiguousResolved) {
      const resolved = readWal(definition.receiptsFile).some((record) => (
        record.v === 'snapback.replay-terminal.v1' && record.seq === wal.ambiguous.seq
      ));
      if (!resolved) {
        throw codedError(
          'SNAPBACK_REPLAY_WAL_PREFIX_MISMATCH',
          `action source ended before ambiguous WAL seq ${wal.ambiguous.seq}`,
        );
      }
    }
    await forceAcknowledgeAll();
  } catch (error) {
    preflightReport ??= error?.details?.preflight ?? null;
    failure = normalizeDiagnostic(error);
  } finally {
    if (heartbeat !== null) clearInterval(heartbeat);
    try { await forceAcknowledgeAll?.(); } catch (error) { failure ??= normalizeDiagnostic(error); }
    try { await pool?.close(); } catch (error) { failure ??= normalizeDiagnostic(error); }
    source.cleanup?.();
  }

  const receipt = {
    v: REPLAY_RECEIPT_VERSION,
    schemaVersion: REPLAY_RECEIPT_VERSION,
    status: failure === null ? 'passed' : 'failed',
    actions: Object.freeze({ ...progress }),
    preflight: preflightReport,
    custody: Object.freeze({
      default: definition.transportCustody,
      duplicatePossible: progress.duplicatePossible,
    }),
    pool: Object.freeze({ configured: definition.clientPool, maximumObserved: pool?.maximumObserved ?? 0 }),
    acknowledgement: Object.freeze({
      countWindow: definition.acknowledgeEvery,
      byteWindow: definition.acknowledgeBytes,
      acknowledged: progress.acknowledged,
      retainedRowOverheadBytes: REPLAY_RETAINED_ROW_OVERHEAD_BYTES,
    }),
    receiptsFile: definition.receiptsFile,
    receiptsDigest: fileDigest(definition.receiptsFile),
    statusFile: definition.statusFile,
    diagnostic: failure,
    finishedAt: Date.now(),
  };
  // A contender that failed the O_EXCL fence must not touch either artifact
  // owned by the live runner. Its returned receipt is still sufficient for
  // CLI machine output and an explicit nonzero exit.
  if (fenceAcquired) {
    try {
      appendWal(definition.receiptsFile, receipt);
      const terminalState = failure?.code === 'SNAPBACK_REPLAY_INTERRUPTED'
        ? 'stopped'
        : failure === null ? 'complete' : 'failed';
      writeStatus(definition, {
        state: terminalState,
        settled: progress.settled,
        failed: failure === null ? progress.failed : Math.max(1, progress.failed),
        total: progress.total,
        lastSeq: progress.lastSeq,
        pid: process.pid,
        diagnostic: failure,
      });
    } finally {
      // The fence covers the summary receipt and final status publication.
      releaseFence(fence);
    }
  }
  return Object.freeze({ receipt: Object.freeze(receipt), exitCode: failure === null ? 0 : 1 });
}

export async function runReplay(definition, options = {}) {
  assertDefinition(definition);
  if (!plainObject(options)) {
    throw codedError('SNAPBACK_REPLAY_DEFINITION_INVALID', 'runReplay options must be an object');
  }
  if (options.detach === true) return detachReplay(definition, options);
  return runAttached(definition, options);
}

export const __replayTest = Object.freeze({
  analyzeWal,
  chargeForResult,
  definiteRefusal,
  preflight,
  processAlive,
  readWal,
  writeStatus,
});

export const __replayWorker = Object.freeze({
  acquireFence,
  releaseFence,
  runAttached,
  writeDetachedFailureStatus,
});
