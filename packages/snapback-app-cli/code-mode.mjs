// Node phase-1 code-mode parent (LLP 0062 §3). The trusted parent owns the
// selected app-data client and every credential. The child receives only
// script text, inert surface metadata, and the closed broker frames below.

import { fork } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';

import { invokeAppFunction } from './index.mjs';
import { jcsCanonical } from './envelope.mjs';
import { EXIT } from './result-core.mjs';

export const CODE_MODE_PROTOCOL_VERSION = 1;
export const CODE_MODE_TRANSFORM = Object.freeze({ name: 'typescript', version: '5.9.3', profile: 'erasable-only' });
export const CODE_MODE_DEFAULTS = Object.freeze({
  timeoutMs: 120_000,
  callTimeoutMs: 60_000,
  maxCalls: 1_000,
  maxSubscriptions: 16,
  maxOutputBytes: 1024 * 1024,
  maxStderrBytes: 1024 * 1024,
  maxBrokerBytes: 1024 * 1024,
  heapMb: 128,
  graceMs: 2_000,
});
export const CODE_MODE_MAXIMA = Object.freeze({
  timeoutMs: 30 * 60_000,
  callTimeoutMs: 5 * 60_000,
  maxCalls: 10_000,
  maxSubscriptions: 256,
  maxOutputBytes: 16 * 1024 * 1024,
  maxStderrBytes: 16 * 1024 * 1024,
  maxBrokerBytes: 4 * 1024 * 1024,
  heapMb: 512,
  graceMs: 10_000,
});

const SCRIPT_MAX_BYTES = 1024 * 1024;
const CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SUBSYSTEM = /^[a-z][a-z0-9._-]{0,63}$/u;
const IDENTIFIER = /^[$_\p{ID_Start}][$\u200c\u200d\p{ID_Continue}]*$/u;
export const CODE_MODE_HAZARDOUS_ALIASES_V1 = Object.freeze([
  '__proto__', 'constructor', 'prototype', 'then', 'catch', 'finally',
  'function', 'inspect', 'toJSON', 'toString', 'valueOf',
]);
const HAZARDOUS_ALIASES = new Set(CODE_MODE_HAZARDOUS_ALIASES_V1);

const errorWith = (code, message, exitCode, fields = undefined, cause = undefined) => {
  const error = new Error(`${code}: ${message}`, cause === undefined ? undefined : { cause });
  error.code = code;
  error.exitCode = exitCode;
  error.diagnostic = Object.freeze({ code, ...(fields === undefined ? {} : { fields }) });
  return error;
};

const bounded = (name, value, defaults, maxima) => {
  const selected = value ?? defaults;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maxima) {
    throw errorWith('SNAPBACK_APP_CLI_USAGE', `${name} must be an integer from 1 through ${maxima}`, EXIT.USAGE);
  }
  return selected;
};

const exactKeys = (value, keys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

export function codeModeBindings(surface) {
  const byId = new Map();
  const aliases = [];
  for (const fn of surface.functions ?? []) {
    if (typeof fn.id !== 'string' || typeof fn.name !== 'string' || !IDENTIFIER.test(fn.name)) {
      throw errorWith(
        'SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID',
        'code mode requires every exported function name to be a syntactically valid identifier',
        EXIT.ARTIFACT_IDENTITY_MISMATCH,
      );
    }
    if (byId.has(fn.id)) {
      throw errorWith('SNAPBACK_APP_CLI_ENVELOPE_GRAMMAR_INVALID', 'code mode function ids must be unique', EXIT.ARTIFACT_IDENTITY_MISMATCH);
    }
    byId.set(fn.id, fn);
    if (!HAZARDOUS_ALIASES.has(fn.name)) aliases.push({ name: fn.name, id: fn.id });
  }
  return Object.freeze({ byId, aliases: Object.freeze(aliases) });
}

const strictProfileWalk = (value, seen, path) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${path} contains a non-canonical number`);
    return;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  seen.add(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 0) throw new TypeError(`${path} contains symbol properties`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError(`${path}.${key} is hidden or accessor-backed`);
  }
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      throw new TypeError(`${path} is sparse or carries named properties`);
    }
    value.forEach((item, index) => strictProfileWalk(item, seen, `${path}[${index}]`));
  } else {
    const prototype = Object.getPrototypeOf(value);
    const plainAcrossRealm = prototype === null
      || (prototype?.constructor?.name === 'Object' && Object.getPrototypeOf(prototype) === null);
    if (!plainAcrossRealm || Object.hasOwn(value, 'toJSON')) throw new TypeError(`${path} has a custom prototype or toJSON hook`);
    for (const [key, item] of Object.entries(value)) strictProfileWalk(item, seen, `${path}.${key}`);
  }
  seen.delete(value);
};

export function assertStrictCodeModeValue(value, label = 'value') {
  strictProfileWalk(value, new Set(), label);
  return value;
}

const applicationValue = (fn, response) => {
  if (fn.kind === 'query' || fn.kind === 'liveQuery') return response?.rows ?? response?.snapshot?.rows ?? response;
  if (fn.kind === 'mutation') return response?.result ?? response;
  return response?.value ?? response?.result ?? response;
};

const safeBrokerError = (error) => {
  const code = CODE.test(error?.code ?? '') ? error.code : 'SNAPBACK_APP_CLI_FUNCTION_ERROR';
  const subsystem = SUBSYSTEM.test(error?.diagnostic?.subsystem ?? '') ? error.diagnostic.subsystem : undefined;
  const exitCode = Number.isSafeInteger(error?.exitCode)
    ? error.exitCode
    : /^SNAPBACK_AUTH_/u.test(code) ? EXIT.AUTH_REFUSED
      : error?.status === 404 ? EXIT.FUNCTION_NOT_FOUND
        : error?.status >= 500 ? EXIT.TRANSPORT_FAILED
          : EXIT.FUNCTION_ERROR;
  return Object.freeze({ code, exitCode, ...(subsystem === undefined ? {} : { subsystem }) });
};

const frameBytes = (frame) => Buffer.byteLength(JSON.stringify(frame));
const sizeClass = (bytes) => (bytes <= 64 ? 'tiny' : bytes <= 1024 ? 'small' : bytes <= 64 * 1024 ? 'medium' : 'large');

const functionSelector = (surface, fn) => (surface.generation === null
  ? fn.name
  : Object.freeze({ name: fn.name, expectedGeneration: surface.generation }));

export async function runCodeMode({
  client,
  surface,
  script,
  scriptSource = 'stdin',
  args = [],
  envelopeHash = surface.envelopeSha256 ?? null,
  timeoutMs,
  callTimeoutMs,
  maxCalls,
  maxSubscriptions,
  maxOutputBytes,
  maxStderrBytes,
  maxBrokerBytes,
  heapMb,
  graceMs,
  principalClass = 'anonymous',
  onStderr = () => {},
} = {}) {
  if (typeof script !== 'string' || Buffer.byteLength(script) > SCRIPT_MAX_BYTES) {
    throw errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'code-mode script exceeds the 1 MiB source ceiling', EXIT.RESOURCE_EXCEEDED);
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw errorWith('SNAPBACK_APP_CLI_USAGE', 'code-mode args must be strings', EXIT.USAGE);
  }
  const limits = Object.freeze({
    timeoutMs: bounded('timeoutMs', timeoutMs, CODE_MODE_DEFAULTS.timeoutMs, CODE_MODE_MAXIMA.timeoutMs),
    callTimeoutMs: bounded('callTimeoutMs', callTimeoutMs, CODE_MODE_DEFAULTS.callTimeoutMs, CODE_MODE_MAXIMA.callTimeoutMs),
    maxCalls: bounded('maxCalls', maxCalls, CODE_MODE_DEFAULTS.maxCalls, CODE_MODE_MAXIMA.maxCalls),
    maxSubscriptions: bounded(
      'maxSubscriptions',
      maxSubscriptions,
      CODE_MODE_DEFAULTS.maxSubscriptions,
      CODE_MODE_MAXIMA.maxSubscriptions,
    ),
    maxOutputBytes: bounded('maxOutputBytes', maxOutputBytes, CODE_MODE_DEFAULTS.maxOutputBytes, CODE_MODE_MAXIMA.maxOutputBytes),
    maxStderrBytes: bounded('maxStderrBytes', maxStderrBytes, CODE_MODE_DEFAULTS.maxStderrBytes, CODE_MODE_MAXIMA.maxStderrBytes),
    maxBrokerBytes: bounded('maxBrokerBytes', maxBrokerBytes, CODE_MODE_DEFAULTS.maxBrokerBytes, CODE_MODE_MAXIMA.maxBrokerBytes),
    heapMb: bounded('heapMb', heapMb, CODE_MODE_DEFAULTS.heapMb, CODE_MODE_MAXIMA.heapMb),
    graceMs: bounded('graceMs', graceMs, CODE_MODE_DEFAULTS.graceMs, CODE_MODE_MAXIMA.graceMs),
  });
  const bindings = codeModeBindings(surface);
  const scriptHash = createHash('sha256').update(script, 'utf8').digest('hex');
  const auditKey = randomBytes(32);
  const auditValueFacts = (value) => {
    const canonical = jcsCanonical(value);
    const bytes = Buffer.byteLength(canonical);
    return Object.freeze({
      sizeClass: sizeClass(bytes),
      commitment: createHmac('sha256', auditKey)
        .update('snapback:app-cli:audit-result:v1\0', 'utf8')
        .update(canonical, 'utf8')
        .digest('hex'),
    });
  };
  const child = fork(new URL('./code-mode-child.mjs', import.meta.url), [], {
    env: { NODE_NO_WARNINGS: '1' },
    execArgv: [`--max-old-space-size=${limits.heapMb}`],
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let callsUsed = 0;
  let stderrBytes = 0;
  let stderrElided = false;
  let terminal = false;
  let subscriptionsPeak = 0;
  const subscriptions = new Map();
  const emit = (record) => {
    const framed = Object.freeze({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, ...record });
    const bytes = frameBytes(framed) + 1;
    if (stderrBytes + bytes > limits.maxStderrBytes) {
      if (!stderrElided) {
        stderrElided = true;
        onStderr(Object.freeze({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'elision', reason: 'stderr-ceiling' }));
      }
      return;
    }
    stderrBytes += bytes;
    onStderr(framed);
  };
  const send = (frame) => {
    if (frameBytes(frame) > limits.maxBrokerBytes) {
      throw errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'broker frame exceeds the message ceiling', EXIT.RESOURCE_EXCEEDED);
    }
    child.send(frame);
  };

  return new Promise((resolve, reject) => {
    let timeout;
    let grace;
    let settledFrame = null;
    let failure = null;
    const disposeSubscription = async (subscriptionId) => {
      const started = subscriptions.get(subscriptionId);
      if (!started) return;
      subscriptions.delete(subscriptionId);
      try {
        started.dispose();
      } finally {
        await started.settled?.();
      }
    };
    const disposeSubscriptions = () => {
      for (const subscriptionId of [...subscriptions.keys()]) {
        void disposeSubscription(subscriptionId).catch(() => {});
      }
    };
    const finish = () => {
      if (terminal) return;
      terminal = true;
      clearTimeout(timeout);
      clearTimeout(grace);
      disposeSubscriptions();
      emit({
        type: 'summary',
        callsUsed,
        callsLimit: limits.maxCalls,
        subscriptionsPeak,
        subscriptionsLimit: limits.maxSubscriptions,
        stderrBytes,
        stderrLimit: limits.maxStderrBytes,
        elided: stderrElided,
      });
      if (child.connected) child.disconnect();
      if (failure !== null) reject(failure);
      else resolve(Object.freeze({
        value: settledFrame?.hasValue ? settledFrame.value : undefined,
        hasValue: settledFrame?.hasValue === true,
        scriptHash,
        callsUsed,
        stderrBytes,
        stderrElided,
      }));
    };
    const beginTeardown = (reason) => {
      if (!child.connected) return;
      disposeSubscriptions();
      send({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'abort', reason });
      grace = setTimeout(() => {
        child.kill('SIGKILL');
        if (failure === null && reason === 'timeout') {
          failure = errorWith('SNAPBACK_APP_CLI_TIMEOUT', 'code-mode run timed out', EXIT.TIMEOUT);
        }
        finish();
      }, limits.graceMs);
    };
    timeout = setTimeout(() => {
      failure = errorWith('SNAPBACK_APP_CLI_TIMEOUT', 'code-mode run timed out', EXIT.TIMEOUT);
      beginTeardown('timeout');
    }, limits.timeoutMs);

    child.on('message', async (frame) => {
      try {
        if (!exactKeys(frame, frame.type === 'call'
          ? ['protocolVersion', 'type', 'callId', 'functionId', 'args', 'timeoutMs']
          : frame.type === 'liveOpen'
            ? ['protocolVersion', 'type', 'subscriptionId', 'functionId', 'args', 'timeoutMs']
            : frame.type === 'liveClose'
              ? ['protocolVersion', 'type', 'subscriptionId']
          : frame.type === 'console'
            ? ['protocolVersion', 'type', 'level', 'text']
            : frame.type === 'settled'
              ? ['protocolVersion', 'type', 'hasValue', 'value']
              : frame.type === 'failed'
                ? ['protocolVersion', 'type', 'error']
                : ['protocolVersion', 'type'])
          || frame.protocolVersion !== CODE_MODE_PROTOCOL_VERSION) {
          throw errorWith('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'child emitted an invalid broker frame', EXIT.SCRIPT_ERROR);
        }
        if (frameBytes(frame) > limits.maxBrokerBytes) throw errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'child broker frame exceeds the message ceiling', EXIT.RESOURCE_EXCEEDED);
        if (frame.type === 'console') {
          emit({ type: 'console', level: String(frame.level).slice(0, 16), text: String(frame.text).slice(0, 64 * 1024) });
          return;
        }
        if (frame.type === 'call') {
          callsUsed += 1;
          if (callsUsed > limits.maxCalls) {
            send({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'callResult', callId: frame.callId, ok: false, error: { code: 'SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', exitCode: EXIT.RESOURCE_EXCEEDED } });
            return;
          }
          const fn = bindings.byId.get(frame.functionId);
          if (!fn) {
            send({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'callResult', callId: frame.callId, ok: false, error: { code: 'SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', exitCode: EXIT.FUNCTION_NOT_FOUND } });
            return;
          }
          if (principalClass === 'anonymous' && fn.authRequirement === 'authenticated') {
            send({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'callResult', callId: frame.callId, ok: false, error: { code: 'SNAPBACK_APP_CLI_USAGE', exitCode: EXIT.USAGE } });
            return;
          }
          assertStrictCodeModeValue(frame.args, 'broker args');
          const selectedTimeout = bounded('per-call timeout', frame.timeoutMs, limits.callTimeoutMs, CODE_MODE_MAXIMA.callTimeoutMs);
          let timer;
          try {
            if (fn.kind === 'liveQuery') {
              throw errorWith(
                'SNAPBACK_APP_CLI_USAGE',
                'live queries must use the subscription broker frames',
                EXIT.USAGE,
              );
            }
            const operation = invokeAppFunction(client, surface, fn.name, frame.args);
            const response = await Promise.race([
              operation,
              new Promise((_, rejectCall) => {
                timer = setTimeout(() => rejectCall(errorWith('SNAPBACK_APP_CLI_TIMEOUT', 'brokered call timed out', EXIT.TIMEOUT)), selectedTimeout);
              }),
            ]);
            const value = applicationValue(fn, response);
            assertStrictCodeModeValue(value, 'broker result');
            const reply = { protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'callResult', callId: frame.callId, ok: true, value };
            send(reply);
            emit({ type: 'call', functionId: fn.id, scriptHash, outcome: 'ok', ...auditValueFacts(value) });
          } catch (error) {
            const safe = safeBrokerError(error);
            send({ protocolVersion: CODE_MODE_PROTOCOL_VERSION, type: 'callResult', callId: frame.callId, ok: false, error: safe });
            emit({ type: 'call', functionId: fn.id, scriptHash, outcome: 'refused', code: safe.code });
          } finally {
            clearTimeout(timer);
          }
          return;
        }
        if (frame.type === 'liveOpen') {
          callsUsed += 1;
          const refuseOpen = (error) => send({
            protocolVersion: CODE_MODE_PROTOCOL_VERSION,
            type: 'liveOpened',
            subscriptionId: frame.subscriptionId,
            ok: false,
            error: safeBrokerError(error),
          });
          if (callsUsed > limits.maxCalls) {
            refuseOpen(errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'brokered-call ceiling exceeded', EXIT.RESOURCE_EXCEEDED));
            return;
          }
          if (subscriptions.has(frame.subscriptionId) || subscriptions.size >= limits.maxSubscriptions) {
            refuseOpen(errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'open-subscription ceiling exceeded', EXIT.RESOURCE_EXCEEDED));
            return;
          }
          const fn = bindings.byId.get(frame.functionId);
          if (!fn || fn.kind !== 'liveQuery') {
            refuseOpen(errorWith('SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND', 'live-query function was not found', EXIT.FUNCTION_NOT_FOUND));
            return;
          }
          if (principalClass === 'anonymous' && fn.authRequirement === 'authenticated') {
            refuseOpen(errorWith('SNAPBACK_APP_CLI_USAGE', 'anonymous principal cannot subscribe to an authenticated function', EXIT.USAGE));
            return;
          }
          try {
            assertStrictCodeModeValue(frame.args, 'broker args');
            const selectedTimeout = bounded(
              'per-call timeout',
              frame.timeoutMs,
              limits.callTimeoutMs,
              CODE_MODE_MAXIMA.callTimeoutMs,
            );
            if (typeof client.startLiveQuery !== 'function') {
              throw errorWith('SNAPBACK_APP_CLI_VERSION_MISMATCH', 'client lacks managed live-query support', EXIT.VERSION_MISMATCH);
            }
            const started = client.startLiveQuery(functionSelector(surface, fn), {
              args: frame.args,
              connectionId: `snapback-app-cli-code-${process.pid}-${frame.subscriptionId}`,
              transport: 'stream',
              onUpdate: (rows) => {
                if (terminal || !subscriptions.has(frame.subscriptionId)) return;
                try {
                  assertStrictCodeModeValue(rows, 'live broker result');
                  send({
                    protocolVersion: CODE_MODE_PROTOCOL_VERSION,
                    type: 'liveValue',
                    subscriptionId: frame.subscriptionId,
                    value: rows,
                  });
                } catch (error) {
                  send({
                    protocolVersion: CODE_MODE_PROTOCOL_VERSION,
                    type: 'liveTerminal',
                    subscriptionId: frame.subscriptionId,
                    error: safeBrokerError(error),
                  });
                  void disposeSubscription(frame.subscriptionId).catch(() => {});
                }
              },
              onAuthorizationError: (error) => {
                if (terminal || !subscriptions.has(frame.subscriptionId)) return;
                send({
                  protocolVersion: CODE_MODE_PROTOCOL_VERSION,
                  type: 'liveTerminal',
                  subscriptionId: frame.subscriptionId,
                  error: safeBrokerError(error),
                });
                void disposeSubscription(frame.subscriptionId).catch(() => {});
              },
            });
            subscriptions.set(frame.subscriptionId, started);
            subscriptionsPeak = Math.max(subscriptionsPeak, subscriptions.size);
            let timer;
            try {
              await Promise.race([
                started.started(),
                new Promise((_, rejectStart) => {
                  timer = setTimeout(() => rejectStart(errorWith(
                    'SNAPBACK_APP_CLI_TIMEOUT',
                    'live subscription establishment timed out',
                    EXIT.TIMEOUT,
                  )), selectedTimeout);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
            send({
              protocolVersion: CODE_MODE_PROTOCOL_VERSION,
              type: 'liveOpened',
              subscriptionId: frame.subscriptionId,
              ok: true,
            });
            emit({ type: 'call', functionId: fn.id, scriptHash, outcome: 'ok', callKind: 'live-open' });
          } catch (error) {
            await disposeSubscription(frame.subscriptionId).catch(() => {});
            refuseOpen(error);
          }
          return;
        }
        if (frame.type === 'liveClose') {
          await disposeSubscription(frame.subscriptionId).catch(() => {});
          send({
            protocolVersion: CODE_MODE_PROTOCOL_VERSION,
            type: 'liveClosed',
            subscriptionId: frame.subscriptionId,
          });
          return;
        }
        if (frame.type === 'settled') {
          if (frame.hasValue) assertStrictCodeModeValue(frame.value, 'script result');
          const bytes = frame.hasValue ? Buffer.byteLength(JSON.stringify(frame.value)) : 0;
          if (bytes > limits.maxOutputBytes) throw errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'code-mode result exceeds the stdout ceiling', EXIT.RESOURCE_EXCEEDED);
          settledFrame = structuredClone(frame);
          beginTeardown('settled');
          return;
        }
        if (frame.type === 'failed') {
          const childError = frame.error ?? {};
          failure = errorWith(
            CODE.test(childError.code ?? '') ? childError.code : 'SNAPBACK_APP_CLI_SCRIPT_ERROR',
            'code-mode child failed',
            Number.isSafeInteger(childError.exitCode) ? childError.exitCode : EXIT.SCRIPT_ERROR,
          );
          beginTeardown('failed');
          return;
        }
        if (frame.type === 'done') finish();
      } catch (error) {
        failure = error;
        beginTeardown('failed');
      }
    });
    child.once('error', (error) => {
      failure = errorWith('SNAPBACK_APP_CLI_SCRIPT_ERROR', 'code-mode child process failed', EXIT.SCRIPT_ERROR, undefined, error);
      finish();
    });
    child.once('exit', (code, signal) => {
      if (!terminal && failure === null && settledFrame === null) {
        failure = signal === 'SIGABRT'
          ? errorWith('SNAPBACK_APP_CLI_RESOURCE_EXCEEDED', 'code-mode heap ceiling terminated the child', EXIT.RESOURCE_EXCEEDED)
          : errorWith('SNAPBACK_APP_CLI_SCRIPT_ERROR', `code-mode child exited before settlement (${code ?? signal})`, EXIT.SCRIPT_ERROR);
      }
      finish();
    });
    send({
      protocolVersion: CODE_MODE_PROTOCOL_VERSION,
      type: 'start',
      script,
      scriptSource,
      args,
      envelopeHash,
      defaultCallTimeoutMs: limits.callTimeoutMs,
      functions: [...bindings.byId.values()].map((fn) => ({ id: fn.id, name: fn.name, kind: fn.kind })),
      aliases: bindings.aliases,
      transform: CODE_MODE_TRANSFORM,
    });
  });
}

export function renderCodeModeTypes(surface) {
  const bindings = codeModeBindings(surface);
  const lines = [
    '// Generated by @expo/snapback-app-cli. Engine-owned code-mode ambient declarations.',
    `// Transform: ${CODE_MODE_TRANSFORM.name}@${CODE_MODE_TRANSFORM.version} (${CODE_MODE_TRANSFORM.profile}).`,
    'declare const args: readonly string[];',
    'declare const signal: AbortSignal;',
    'declare const console: Readonly<{',
    '  log(...values: unknown[]): void;',
    '  info(...values: unknown[]): void;',
    '  warn(...values: unknown[]): void;',
    '  error(...values: unknown[]): void;',
    '  debug(...values: unknown[]): void;',
    '}>;',
    'declare function setTimeout(callback: (...values: unknown[]) => void, delay?: number, ...values: unknown[]): unknown;',
    'declare function clearTimeout(timer: unknown): void;',
    'declare const snapback: Readonly<{',
    '  envelopeHash: string | null;',
    '  function(id: string): (args?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown> | AsyncIterable<unknown>;',
    '}>;',
    '',
    'declare const api: Readonly<{',
  ];
  for (const { name, id } of bindings.aliases) {
    const fn = bindings.byId.get(id);
    lines.push(`  readonly ${JSON.stringify(name)}: ${fn.kind === 'liveQuery'
      ? '(args?: Record<string, unknown>, options?: { timeoutMs?: number }) => AsyncIterable<unknown>'
      : '(args?: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>'};`);
  }
  lines.push('}>;', '');
  return `${lines.join('\n')}\n`;
}
