import { createHash, randomBytes } from 'node:crypto';

import { invokeAppFunction, startAppFunctionLive } from './index.mjs';
import { jcsCanonical } from './envelope.mjs';

const PROTOCOL = 'ibex/restricted-worker-broker/1';
const HAZARDS = new Set([
  '__proto__', 'constructor', 'prototype', 'then', 'catch', 'finally',
  'function', 'inspect', 'toJSON', 'toString', 'valueOf',
]);
const IDENTIFIER = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;

const failure = (code, message, exitCode, fields = undefined) => Object.assign(new Error(message), {
  code,
  exitCode,
  diagnostic: Object.freeze({ code, ...(fields === undefined ? {} : { fields }) }),
});

const digest = (bytes) => `sha256-${createHash('sha256').update(bytes).digest('base64url')}`;

const applicationValue = (fn, response) => {
  if (fn.kind === 'query' || fn.kind === 'liveQuery') return response?.rows ?? response?.snapshot?.rows ?? response;
  if (fn.kind === 'mutation') return response?.result ?? response;
  return response?.value ?? response?.result ?? response;
};

const safeError = (error) => Object.freeze({
  code: /^[A-Z][A-Z0-9_]{0,127}$/u.test(error?.code ?? '') ? error.code : 'SNAPBACK_APP_CLI_FUNCTION_ERROR',
  exitClass: Number.isSafeInteger(error?.exitCode) && error.exitCode >= 2 && error.exitCode <= 11
    ? error.exitCode
    : error?.status === 404 ? 4 : error?.status >= 500 ? 6 : 5,
  recognized: typeof error?.code === 'string' && error.code.startsWith('SNAPBACK_'),
  locus: typeof error?.status === 'number' ? 'request' : 'engine',
  safeFields: Object.freeze({}),
  attribution: null,
});

const bounded = (selected, fallback, maximum, label) => {
  const value = selected ?? fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw failure('SNAPBACK_APP_CLI_USAGE', `${label} exceeds the app-bound worker contract`, 2);
  }
  return value;
};

const envelopeDigest = (surface) => {
  const value = surface.envelopeSha256 ?? surface.envelopeDigest ?? surface.envelopeHash;
  if (typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)) {
    return `sha256-${Buffer.from(value, 'hex').toString('base64url')}`;
  }
  if (typeof value !== 'string' || !/^sha256-[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw failure('SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH', 'the admitted surface has no canonical envelope digest', 7);
  }
  return value;
};

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// The only native object reached here is installed by an admitted app-bound
// Stub V4. It owns a separate restricted Hermes runtime and exposes no generic
// eval/runtime handle to this trusted parent.
// @ref LLP 0062#6-packaging-phases — the trusted parent owns the credential and brokers the restricted embedded worker
export async function runIbexCodeMode({
  client,
  surface,
  script,
  scriptSource = 'stdin.ts',
  args = [],
  timeoutMs,
  callTimeoutMs,
  maxCalls,
  maxSubscriptions,
  maxOutputBytes,
  maxStderrBytes,
  maxBrokerBytes,
  heapMb,
  graceMs,
  onStderr = () => {},
} = {}) {
  const bridge = globalThis.__ibexAppBoundWorkerV1;
  if (bridge === null || typeof bridge !== 'object') {
    throw failure('SNAPBACK_APP_CLI_VERSION_MISMATCH', 'the app-bound Ibex worker bridge is unavailable', 8);
  }
  const contract = JSON.parse(bridge.contract);
  const defaults = contract.defaults;
  const maxima = contract.maxima;
  const limits = Object.freeze({
    sourceBytes: maxima.sourceBytes,
    transformedSourceBytes: maxima.transformedSourceBytes,
    sourceMapBytes: maxima.sourceMapBytes,
    transformArenaBytes: maxima.transformArenaBytes,
    runWallMs: bounded(timeoutMs, defaults.runWallMs, maxima.runWallMs, '--timeout-ms'),
    callEstablishmentMs: bounded(callTimeoutMs, defaults.callEstablishmentMs, maxima.callEstablishmentMs, '--call-timeout-ms'),
    brokerOperations: bounded(maxCalls, defaults.brokerOperations, maxima.brokerOperations, '--max-calls'),
    openSubscriptions: bounded(maxSubscriptions, defaults.openSubscriptions, maxima.openSubscriptions, '--max-subscriptions'),
    frameBytes: bounded(maxBrokerBytes, defaults.frameBytes, maxima.frameBytes, '--max-broker-bytes'),
    resultBytes: bounded(maxOutputBytes, defaults.resultBytes, maxima.resultBytes, '--max-output-bytes'),
    stderrBytes: bounded(maxStderrBytes, defaults.stderrBytes, maxima.stderrBytes, '--max-stderr-bytes'),
    heapBytes: bounded(heapMb === undefined ? undefined : heapMb * 1024 * 1024, defaults.heapBytes, maxima.heapBytes, '--heap-mb'),
    graceMs: bounded(graceMs, defaults.graceMs, maxima.graceMs, '--grace-ms'),
    openTimers: defaults.openTimers,
  });
  const limitsBytes = jcsCanonical(limits);
  const transformed = JSON.parse(bridge.transformExternalScript(scriptSource, script));
  const runId = randomBytes(16).toString('hex');
  const arming = Object.freeze({
    schema: 'ibex/restricted-worker-arming/1',
    principal: Object.freeze({
      kind: 'external-script',
      appBindingDigest: contract.appBindingDigest,
      sourceDigest: transformed.sourceDigest,
      runId,
    }),
    transformedSourceDigest: transformed.transformedSourceDigest,
    sourceMapDigest: transformed.sourceMapDigest,
    engineCompatibilityDigest: contract.engineCompatibilityDigest,
    languageProfileDigest: contract.languageDigest,
    workerPolicyDigest: contract.workerPolicyDigest,
    brokerProtocol: contract.broker,
    globalInventoryDigest: contract.globalsDigest,
    effectiveLimitsDigest: bridge.digestLimits(limitsBytes),
    dynamicCode: 'disabled',
    moduleRegistry: 'empty',
    capabilities: Object.freeze(['broker:snapback-app-cli:1']),
  });
  const functions = [...surface.functions]
    .map((fn) => Object.freeze({
      id: fn.id,
      kind: fn.kind === 'liveQuery' ? 'live-query' : fn.kind,
      alias: IDENTIFIER.test(fn.name) && !HAZARDS.has(fn.name) ? fn.name : null,
    }))
    .sort((left, right) => Buffer.from(left.id).compare(Buffer.from(right.id)));
  const start = Object.freeze({
    schema: PROTOCOL,
    runId,
    sequence: 1,
    type: 'start',
    body: Object.freeze({
      profile: Object.freeze({
        language: contract.language,
        languageDigest: contract.languageDigest,
        workerPolicy: contract.workerPolicy,
        workerPolicyDigest: contract.workerPolicyDigest,
        broker: contract.broker,
        globalsDigest: contract.globalsDigest,
      }),
      sourceDigest: transformed.sourceDigest,
      transformedSourceDigest: transformed.transformedSourceDigest,
      sourceMapDigest: transformed.sourceMapDigest,
      args: Object.freeze([...args]),
      // The served API envelope names SHA-256 as hex; the broker's closed
      // digest vocabulary uses the equivalent base64url token.
      surface: Object.freeze({ envelopeDigest: envelopeDigest(surface), functions: Object.freeze(functions) }),
      limits,
    }),
  });
  const worker = bridge.create(jcsCanonical(arming), limitsBytes);
  let parentSequence = 2;
  let operations = 0;
  let terminal = false;
  let stderrBytes = 0;
  let stderrElided = false;
  const timers = new Map();
  const establishmentTimers = new Set();
  const live = new Map();
  let settlement = null;
  const send = (type, body) => {
    if (terminal) return false;
    worker.submit(jcsCanonical({ schema: PROTOCOL, runId, sequence: parentSequence++, type, body }));
    return true;
  };
  const emitStderr = (body) => {
    const bytes = Buffer.byteLength(jcsCanonical(body)) + 1;
    if (stderrBytes + bytes > limits.stderrBytes) {
      if (!stderrElided) {
        stderrElided = true;
        onStderr(Object.freeze({ type: 'elision', reason: 'stderr-ceiling' }));
      }
      return;
    }
    stderrBytes += bytes;
    onStderr(body);
  };
  const functionById = (id) => surface.functions.find((fn) => fn.id === id);
  const consumeOperation = () => {
    operations += 1;
    if (operations > limits.brokerOperations) {
      throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'the app-bound broker operation ceiling was reached', 11);
    }
  };
  const deadline = Date.now() + limits.runWallMs;
  try {
    worker.start(transformed.callableSource, transformed.composedSourceMap, jcsCanonical(start));
    while (!terminal) {
      if (Date.now() >= deadline) {
        worker.interrupt();
        throw failure('SNAPBACK_APP_CLI_TIMEOUT', 'the app-bound script deadline expired', 9);
      }
      const event = worker.take(0);
      if (event === undefined) {
        await nextTurn();
        continue;
      }
      if (event.tag === 2) throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'the restricted worker reached a witnessed resource ceiling', 11);
      if (event.tag === 3) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', `restricted worker fault ${event.fault}`, 1);
      if (event.tag === 4) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'restricted worker closed before settlement', 1);
      const frame = JSON.parse(event.frame);
      const body = frame.body;
      if (frame.type === 'call') {
        consumeOperation();
        const fn = functionById(body.functionId);
        if (!fn || fn.kind === 'liveQuery') {
          send('callResult', { callId: body.callId, error: safeError(failure('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 'function id is absent', 4)), ok: false });
          continue;
        }
        let established = false;
        const establishmentTimer = setTimeout(() => {
          establishmentTimers.delete(establishmentTimer);
          if (established || terminal) return;
          established = true;
          send('callResult', {
            callId: body.callId,
            error: safeError(failure('SNAPBACK_APP_CLI_TIMEOUT', 'call establishment timed out', 9)),
            ok: false,
          });
        }, limits.callEstablishmentMs);
        establishmentTimers.add(establishmentTimer);
        void invokeAppFunction(client, surface, fn.name, body.args)
          .then((value) => {
            if (established || terminal) return;
            established = true;
            clearTimeout(establishmentTimer);
            establishmentTimers.delete(establishmentTimer);
            send('callResult', { callId: body.callId, ok: true, value: applicationValue(fn, value) });
          })
          .catch((error) => {
            if (established || terminal) return;
            established = true;
            clearTimeout(establishmentTimer);
            establishmentTimers.delete(establishmentTimer);
            send('callResult', { callId: body.callId, error: safeError(error), ok: false });
          });
      } else if (frame.type === 'liveOpen') {
        consumeOperation();
        const fn = functionById(body.functionId);
        if (!fn || fn.kind !== 'liveQuery' || live.size >= limits.openSubscriptions) {
          send('liveOpened', { subscriptionId: body.subscriptionId, ok: false, error: safeError(failure('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 'live function id is absent', 4)) });
          continue;
        }
        try {
          const snapshots = [];
          const started = startAppFunctionLive(client, surface, fn.name, {
            args: body.args,
            connectionId: `ibex-${runId}-${body.subscriptionId}`,
            transport: 'stream',
            onUpdate: (value) => snapshots.push(value),
          });
          live.set(body.subscriptionId, { started, snapshots });
          let established = false;
          const establishmentTimer = setTimeout(() => {
            establishmentTimers.delete(establishmentTimer);
            if (established || terminal) return;
            established = true;
            started.dispose?.();
            live.delete(body.subscriptionId);
            send('liveOpened', {
              subscriptionId: body.subscriptionId,
              ok: false,
              error: safeError(failure('SNAPBACK_APP_CLI_TIMEOUT', 'live establishment timed out', 9)),
            });
          }, limits.callEstablishmentMs);
          establishmentTimers.add(establishmentTimer);
          void started.started()
            .then(() => {
              if (established || terminal) return;
              established = true;
              clearTimeout(establishmentTimer);
              establishmentTimers.delete(establishmentTimer);
              send('liveOpened', { subscriptionId: body.subscriptionId, ok: true });
            })
            .catch((error) => {
              if (established || terminal) return;
              established = true;
              clearTimeout(establishmentTimer);
              establishmentTimers.delete(establishmentTimer);
              live.delete(body.subscriptionId);
              send('liveOpened', { subscriptionId: body.subscriptionId, ok: false, error: safeError(error) });
            });
        } catch (error) {
          send('liveOpened', { subscriptionId: body.subscriptionId, ok: false, error: safeError(error) });
        }
      } else if (frame.type === 'liveClose') {
        const row = live.get(body.subscriptionId);
        row?.started?.dispose?.();
        live.delete(body.subscriptionId);
        send('liveClosed', { subscriptionId: body.subscriptionId });
      } else if (frame.type === 'timerSet') {
        if (timers.size >= limits.openTimers) throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'the app-bound timer ceiling was reached', 11);
        timers.set(body.timerId, setTimeout(() => {
          timers.delete(body.timerId);
          if (!terminal) send('timerFired', { timerId: body.timerId });
        }, body.delayMs));
      } else if (frame.type === 'timerClear') {
        clearTimeout(timers.get(body.timerId));
        timers.delete(body.timerId);
      } else if (frame.type === 'console') {
        emitStderr(Object.freeze({ protocolVersion: 1, type: 'console', ...body }));
      } else if (frame.type === 'settlementBegin') {
        settlement = { ...body, chunks: [] };
      } else if (frame.type === 'settlementChunk') {
        if (settlement === null || body.index !== settlement.chunks.length) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'invalid settlement chunk order', 1);
        settlement.chunks.push(body.data);
      } else if (frame.type === 'settlementEnd') {
        if (settlement === null) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'settlement ended before it began', 1);
        if (!settlement.hasValue) {
          terminal = true;
          return Object.freeze({ hasValue: false, value: undefined, callsUsed: operations, stderrBytes, stderrElided });
        }
        const bytes = Buffer.concat(settlement.chunks.map((chunk) => Buffer.from(chunk, 'base64url')));
        if (bytes.length !== settlement.byteLength || settlement.chunks.length !== settlement.chunkCount || digest(bytes) !== settlement.digest) {
          throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'settlement digest or count disagrees', 1);
        }
        const text = bytes.toString('utf8');
        const value = JSON.parse(text);
        if (jcsCanonical(value) !== text) throw failure('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'script result is outside the strict value profile', 10);
        terminal = true;
        return Object.freeze({ hasValue: true, value, callsUsed: operations, stderrBytes, stderrElided });
      } else if (frame.type === 'failed') {
        throw frame.body.kind === 'broker'
          ? failure(frame.body.error.code, 'uncaught broker failure', frame.body.error.exitClass)
          : failure('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'the app-bound script failed', 10);
      }
      for (const [subscriptionId, row] of live) {
        const latest = row.snapshots.splice(0).at(-1);
        if (latest !== undefined) send('liveValue', { subscriptionId, value: latest });
      }
    }
    throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'restricted worker terminated without an outcome', 1);
  } finally {
    terminal = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const timer of establishmentTimers) clearTimeout(timer);
    for (const row of live.values()) row.started?.dispose?.();
    worker.destroy();
  }
}
