import { createHash, createHmac, randomBytes } from 'node:crypto';

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
  locus: typeof error?.status === 'number' ? 'request' : 'broker',
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

const sizeClass = (bytes) => bytes === 0 ? 'empty'
  : bytes <= 64 ? 'tiny'
    : bytes <= 1024 ? 'small'
      : bytes <= 65536 ? 'medium'
        : 'large';

const terminalReason = (error) => error?.terminalReason ?? (error?.code === 'SNAPBACK_APP_CLI_TIMEOUT' ? 'run-timeout'
  : error?.code === 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED' ? 'resource-exceeded'
    : error?.code === 'SNAPBACK_APP_CLI_SCRIPT_ERROR' ? 'script-failure'
      : error?.exitCode >= 2 && error?.exitCode <= 9 ? 'broker-failure'
        : 'engine-fault');

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
  let terminalSelected = false;
  let stderrBytes = 0;
  let stderrElided = false;
  let subscriptionsPeak = 0;
  let lateFrameReported = false;
  let auditClosed = false;
  const auditKey = randomBytes(32);
  const summaryReserve = Math.min(1024, Math.floor(limits.stderrBytes * 3 / 4));
  const timers = new Map();
  const establishmentTimers = new Set();
  const live = new Map();
  const drainLiveSnapshots = () => {
    for (const [subscriptionId, row] of live) {
      const latest = row.snapshots.splice(0).at(-1);
      if (latest === undefined) continue;
      try {
        if (Buffer.byteLength(jcsCanonical(latest)) > limits.frameBytes - 1024) {
          throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'a parent live result exceeds the broker frame ceiling', 11);
        }
      } catch (error) {
        if (error?.code === 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED') throw error;
        throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'a parent live result is outside the strict value profile', 1);
      }
      send('liveValue', { subscriptionId, value: latest });
    }
  };
  let settlement = null;
  let asynchronousFailure = null;
  let parentSignal = null;
  const signalNumbers = Object.freeze({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 });
  const signalHandlers = Object.fromEntries(Object.entries(signalNumbers).map(([name, number]) => [name, () => {
    if (parentSignal === null) parentSignal = Object.freeze({ name, number });
  }]));
  for (const [name, handler] of Object.entries(signalHandlers)) process.on(name, handler);
  const send = (type, body) => {
    if (terminal) return false;
    worker.submit(jcsCanonical({ schema: PROTOCOL, runId, sequence: parentSequence++, type, body }));
    return true;
  };
  const emitRawStderr = (body) => {
    const bytes = Buffer.byteLength(jcsCanonical(body)) + 1;
    if (stderrBytes + bytes > limits.stderrBytes) return false;
    stderrBytes += bytes;
    onStderr(body);
    return true;
  };
  const emitStderr = (body) => {
    const bytes = Buffer.byteLength(jcsCanonical(body)) + 1;
    if (stderrBytes + bytes > limits.stderrBytes - summaryReserve) {
      if (!stderrElided) {
        stderrElided = true;
        emitRawStderr(Object.freeze({ protocolVersion: 1, type: 'elision', reason: 'stderr-ceiling' }));
      }
      return;
    }
    stderrBytes += bytes;
    onStderr(body);
  };
  const functionById = (id) => surface.functions.find((fn) => fn.id === id);
  // @ref LLP 0062#3-code-mode — engine-owned audit records disclose only coarse size and per-run keyed equality evidence
  const auditValue = (value) => {
    const bytes = Buffer.from(jcsCanonical(value));
    return Object.freeze({
      sizeClass: sizeClass(bytes.length),
      commitment: `hmac-sha256-${createHmac('sha256', auditKey).update('snapback-app-cli/audit-value/1\0').update(bytes).digest('base64url')}`,
    });
  };
  const emitCallAudit = (body, outcome, value = undefined, error = undefined) => {
    const safe = error === undefined ? undefined : safeError(error);
    emitStderr(Object.freeze({
      protocolVersion: 1,
      type: 'audit-call',
      callId: body.callId ?? body.subscriptionId,
      functionId: body.functionId,
      envelopeDigest: envelopeDigest(surface),
      script: Object.freeze({ digest: transformed.sourceDigest, source: scriptSource === 'stdin.ts' ? 'stdin' : 'file' }),
      outcome,
      ...(value === undefined ? {} : { value: auditValue(value) }),
      ...(safe === undefined ? {} : {
        error: Object.freeze({
          code: safe.code,
          exitClass: safe.exitClass,
          recognized: safe.recognized,
          locus: safe.locus,
          safeFields: safe.safeFields,
          attribution: safe.attribution,
        }),
      }),
    }));
  };
  const closeAudit = (outputBytes) => {
    if (auditClosed) return;
    auditClosed = true;
    emitRawStderr(Object.freeze({
      protocolVersion: 1,
      type: 'audit-summary',
      callsUsed: operations,
      callsLimit: limits.brokerOperations,
      subscriptionsPeak,
      subscriptionsLimit: limits.openSubscriptions,
      outputBytes,
      outputLimit: limits.resultBytes,
      stderrBytes,
      stderrLimit: limits.stderrBytes,
      elisions: stderrElided ? 1 : 0,
    }));
  };
  const consumeOperation = () => {
    operations += 1;
    if (operations > limits.brokerOperations) {
      throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'the app-bound broker operation ceiling was reached', 11);
    }
  };
  const deadline = Date.now() + limits.runWallMs;
  // @ref LLP 0062#3-code-mode — terminalization is signal-first and keeps only the bounded local-cleanup lane open during grace
  const drainGrace = async (reason, signal = null) => {
    terminalSelected = true;
    send('abort', { reason, signal });
    const graceDeadline = Date.now() + limits.graceMs;
    let workerClosed = false;
    while (Date.now() < graceDeadline) {
      const event = worker.take(0);
      if (event === undefined) {
        await nextTurn();
        continue;
      }
      if (event.tag === 4) {
        workerClosed = true;
        break;
      }
      if (event.tag !== 1) continue;
      const frame = JSON.parse(event.frame);
      const body = frame.body;
      if (frame.type === 'console') {
        emitStderr(Object.freeze({ protocolVersion: 1, type: 'console', ...body }));
      } else if (frame.type === 'call') {
        operations += 1;
        const refused = failure('SNAPBACK_APP_CLI_ABORTED', 'broker calls are refused during teardown grace', 9);
        emitCallAudit(body, 'refused-during-grace', undefined, refused);
        send('callResult', { callId: body.callId, error: safeError(refused), ok: false });
      } else if (frame.type === 'liveOpen') {
        operations += 1;
        const refused = failure('SNAPBACK_APP_CLI_ABORTED', 'subscriptions are refused during teardown grace', 9);
        emitCallAudit(body, 'refused-during-grace', undefined, refused);
        send('liveOpened', { subscriptionId: body.subscriptionId, error: safeError(refused), ok: false });
      } else if (frame.type === 'liveClose') {
        const row = live.get(body.subscriptionId);
        row?.started?.dispose?.();
        live.delete(body.subscriptionId);
        send('liveClosed', { subscriptionId: body.subscriptionId });
      } else if (frame.type === 'timerClear') {
        clearTimeout(timers.get(body.timerId));
        timers.delete(body.timerId);
      } else if (!lateFrameReported) {
        lateFrameReported = true;
        emitStderr(Object.freeze({ protocolVersion: 1, type: 'diagnostic', code: 'SNAPBACK_APP_CLI_LATE_FRAME_DROPPED' }));
      }
    }
    if (!workerClosed) {
      worker.interrupt();
      const acknowledgementDeadline = Date.now() + 250;
      while (Date.now() < acknowledgementDeadline) {
        const event = worker.take(0);
        if (event?.tag === 4) break;
        if (event?.tag === 1) {
          const frame = JSON.parse(event.frame);
          if (frame.type === 'console') emitStderr(Object.freeze({ protocolVersion: 1, type: 'console', ...frame.body }));
          else if (!lateFrameReported) {
            lateFrameReported = true;
            emitStderr(Object.freeze({ protocolVersion: 1, type: 'diagnostic', code: 'SNAPBACK_APP_CLI_LATE_FRAME_DROPPED' }));
          }
        }
        await nextTurn();
      }
    }
    if (signal !== null && typeof bridge.ackParentSignal === 'function') bridge.ackParentSignal(signal);
  };
  try {
    worker.start(transformed.callableSource, transformed.composedSourceMap, jcsCanonical(start));
    while (!terminal) {
      if (asynchronousFailure !== null) throw asynchronousFailure;
      const observedAt = Date.now();
      const event = worker.take(0);
      const nativeSignal = typeof bridge.parentSignal === 'function' ? bridge.parentSignal() : 0;
      if (parentSignal === null && Number.isInteger(nativeSignal) && nativeSignal > 0) {
        const name = Object.entries(signalNumbers).find(([, number]) => number === nativeSignal)?.[0] ?? `signal ${nativeSignal}`;
        parentSignal = Object.freeze({ name, number: nativeSignal });
      }
      if (parentSignal !== null && (event?.tag !== 1 || JSON.parse(event.frame).type !== 'settlementEnd')) {
        throw Object.assign(failure('SNAPBACK_APP_CLI_SIGNAL', `the app-bound script received ${parentSignal.name}`, 128 + parentSignal.number), {
          signalExit: true,
          terminalReason: 'parent-signal',
          signalNumber: parentSignal.number,
        });
      }
      if (event === undefined) {
        if (observedAt >= deadline) throw failure('SNAPBACK_APP_CLI_TIMEOUT', 'the app-bound script deadline expired', 9);
        // Live updates are callbacks from the client, not worker-originated
        // frames. Drain them while the worker is idle on iterator.next();
        // waiting for another worker frame here deadlocks both sides.
        drainLiveSnapshots();
        await nextTurn();
        continue;
      }
      if (event.tag === 3) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', `restricted worker fault ${event.fault}`, 1);
      if (event.tag === 4) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'restricted worker closed before settlement', 1);
      if (observedAt >= deadline && (event.tag !== 1 || JSON.parse(event.frame).type !== 'settlementEnd')) {
        throw failure('SNAPBACK_APP_CLI_TIMEOUT', 'the app-bound script deadline expired', 9);
      }
      if (event.tag === 2) throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'the restricted worker reached a witnessed resource ceiling', 11);
      const frame = JSON.parse(event.frame);
      const body = frame.body;
      if (settlement !== null && frame.type !== 'settlementChunk' && frame.type !== 'settlementEnd') {
        throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'a frame interleaved the provisional settlement', 1);
      }
      if (frame.type === 'call') {
        if (terminalSelected) continue;
        consumeOperation();
        const fn = functionById(body.functionId);
        if (!fn || fn.kind === 'liveQuery') {
          const error = failure('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 'function id is absent', 4);
          emitCallAudit(body, 'refused', undefined, error);
          send('callResult', { callId: body.callId, error: safeError(error), ok: false });
          continue;
        }
        let established = false;
        const establishmentTimer = setTimeout(() => {
          establishmentTimers.delete(establishmentTimer);
          if (established || terminal || terminalSelected) return;
          established = true;
          const error = failure('SNAPBACK_APP_CLI_TIMEOUT', 'call establishment timed out', 9);
          emitCallAudit(body, 'refused', undefined, error);
          send('callResult', {
            callId: body.callId,
            error: safeError(error),
            ok: false,
          });
        }, limits.callEstablishmentMs);
        establishmentTimers.add(establishmentTimer);
        void invokeAppFunction(client, surface, fn.name, body.args)
          .then((value) => {
            if (established || terminal || terminalSelected) return;
            established = true;
            clearTimeout(establishmentTimer);
            establishmentTimers.delete(establishmentTimer);
            const result = applicationValue(fn, value);
            try {
              if (Buffer.byteLength(jcsCanonical(result)) > limits.frameBytes - 1024) {
                asynchronousFailure = failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'a parent call result exceeds the broker frame ceiling', 11);
                return;
              }
            } catch {
              asynchronousFailure = failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'a parent call result is outside the strict value profile', 1);
              return;
            }
            emitCallAudit(body, 'success', result);
            send('callResult', { callId: body.callId, ok: true, value: result });
          })
          .catch((error) => {
            if (established || terminal || terminalSelected) return;
            established = true;
            clearTimeout(establishmentTimer);
            establishmentTimers.delete(establishmentTimer);
            emitCallAudit(body, 'refused', undefined, error);
            send('callResult', { callId: body.callId, error: safeError(error), ok: false });
          });
      } else if (frame.type === 'liveOpen') {
        consumeOperation();
        const fn = functionById(body.functionId);
        if (!fn || fn.kind !== 'liveQuery' || live.size >= limits.openSubscriptions) {
          const error = failure('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 'live function id is absent or the subscription ceiling was reached', 4);
          emitCallAudit(body, 'refused', undefined, error);
          send('liveOpened', { subscriptionId: body.subscriptionId, ok: false, error: safeError(error) });
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
          subscriptionsPeak = Math.max(subscriptionsPeak, live.size);
          let established = false;
          const establishmentTimer = setTimeout(() => {
            establishmentTimers.delete(establishmentTimer);
            if (established || terminal || terminalSelected) return;
            established = true;
            started.dispose?.();
            live.delete(body.subscriptionId);
            const error = failure('SNAPBACK_APP_CLI_TIMEOUT', 'live establishment timed out', 9);
            emitCallAudit(body, 'refused', undefined, error);
            send('liveOpened', {
              subscriptionId: body.subscriptionId,
              ok: false,
              error: safeError(error),
            });
          }, limits.callEstablishmentMs);
          establishmentTimers.add(establishmentTimer);
          void started.started()
            .then(() => {
              if (established || terminal || terminalSelected) return;
              established = true;
              clearTimeout(establishmentTimer);
              establishmentTimers.delete(establishmentTimer);
              emitCallAudit(body, 'success');
              send('liveOpened', { subscriptionId: body.subscriptionId, ok: true });
            })
            .catch((error) => {
              if (established || terminal || terminalSelected) return;
              established = true;
              clearTimeout(establishmentTimer);
              establishmentTimers.delete(establishmentTimer);
              live.delete(body.subscriptionId);
              emitCallAudit(body, 'refused', undefined, error);
              send('liveOpened', { subscriptionId: body.subscriptionId, ok: false, error: safeError(error) });
            });
        } catch (error) {
          emitCallAudit(body, 'refused', undefined, error);
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
        if (settlement !== null) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'duplicate settlement begin', 1);
        if (body.byteLength > limits.resultBytes) throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'script result exceeds the output ceiling', 11);
        settlement = { ...body, chunks: [] };
      } else if (frame.type === 'settlementChunk') {
        if (settlement === null || !settlement.hasValue || body.index !== settlement.chunks.length || settlement.chunks.length >= settlement.chunkCount) {
          throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'invalid settlement chunk order', 1);
        }
        const chunk = Buffer.from(body.data, 'base64url');
        const admittedBytes = settlement.chunks.reduce((total, row) => total + row.length, 0);
        if (admittedBytes + chunk.length > settlement.byteLength || admittedBytes + chunk.length > limits.resultBytes) {
          throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'script result exceeds the output ceiling', 11);
        }
        settlement.chunks.push(chunk);
      } else if (frame.type === 'settlementEnd') {
        if (settlement === null) throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'settlement ended before it began', 1);
        if (!settlement.hasValue) {
          await drainGrace('settled');
          closeAudit(0);
          terminal = true;
          return Object.freeze({ hasValue: false, value: undefined, callsUsed: operations, stderrBytes, stderrElided });
        }
        const bytes = Buffer.concat(settlement.chunks);
        if (settlement.byteLength > limits.resultBytes || bytes.length > limits.resultBytes) {
          throw failure('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'script result exceeds the output ceiling', 11);
        }
        if (bytes.length !== settlement.byteLength || settlement.chunks.length !== settlement.chunkCount || digest(bytes) !== settlement.digest) {
          throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'settlement digest or count disagrees', 1);
        }
        const text = bytes.toString('utf8');
        const value = JSON.parse(text);
        if (jcsCanonical(value) !== text) throw failure('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'script result is outside the strict value profile', 10);
        await drainGrace('settled');
        closeAudit(bytes.length);
        terminal = true;
        return Object.freeze({ hasValue: true, value, callsUsed: operations, stderrBytes, stderrElided });
      } else if (frame.type === 'failed') {
        throw frame.body.kind === 'broker'
          ? failure(frame.body.error.code, 'uncaught broker failure', frame.body.error.exitClass)
          : failure('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'the app-bound script failed', 10);
      }
      drainLiveSnapshots();
    }
    throw failure('SNAPBACK_APP_CLI_ENGINE_INTERNAL', 'restricted worker terminated without an outcome', 1);
  } catch (error) {
    if (!terminalSelected) await drainGrace(terminalReason(error), error?.signalNumber ?? null);
    closeAudit(0);
    throw error;
  } finally {
    terminal = true;
    for (const timer of timers.values()) clearTimeout(timer);
    for (const timer of establishmentTimers) clearTimeout(timer);
    for (const row of live.values()) row.started?.dispose?.();
    worker.destroy();
    for (const [name, handler] of Object.entries(signalHandlers)) process.off(name, handler);
  }
}
