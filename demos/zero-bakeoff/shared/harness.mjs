import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

export async function loadAcceptance(app, root = resolve(import.meta.dirname, '..')) {
  return loadAcceptanceVersion(app, 'v1', root);
}

export async function loadAcceptanceVersion(app, version, root = resolve(import.meta.dirname, '..')) {
  const path = resolve(root, 'protocol', 'acceptance', `${app}.${version}.json`);
  return JSON.parse(await readFile(path, 'utf8'));
}

// @ref LLP 0167#observation-semantics--what-a-delay-means — bakeoff arms
// consume one versioned profile, bounded observation envelope, and explicit
// per-arm commit placement instead of carrying independent latency constants.
export async function loadNetworkCondition(manifest, provider, root = resolve(import.meta.dirname, '..')) {
  const citation = manifest?.networkCondition;
  assert(citation && typeof citation === 'object', 'acceptance manifest must cite a network condition');
  const path = resolve(root, 'protocol', 'acceptance', citation.environmentManifest);
  const environment = JSON.parse(await readFile(path, 'utf8'));
  assertEqual(environment.schemaVersion, citation.environmentSchemaVersion,
    'acceptance environment schema version');
  const profile = environment.networkProfiles?.[citation.profile];
  assert(profile, `environment does not declare network profile ${citation.profile}`);
  assertEqual(profile.name, citation.profile, 'network profile name');
  for (const field of ['mutationAckDelayMs', 'liveDeltaDelayMs', 'queryResponseDelayMs', 'jitterMs']) {
    assert(Number.isInteger(profile[field]) && profile[field] >= 0,
      `network profile ${citation.profile}.${field} must be a non-negative integer`);
  }
  const windows = environment.latencyWindows?.[citation.profile];
  assert(windows, `environment does not declare latency windows for ${citation.profile}`);
  assertJsonEqual(windows, citation.latencyWindows, 'acceptance latency-window citation');
  assertJsonEqual(environment.armInjectionPoints, citation.injectionPoints,
    'acceptance injection-point citation');
  assertEqual(windows.actorAck.floorMs, profile.mutationAckDelayMs,
    'actor-ack floor must match mutationAckDelayMs');
  assertEqual(windows.observerDelta.floorMs, profile.liveDeltaDelayMs,
    'observer-delta floor must match liveDeltaDelayMs');
  const injectionPoint = environment.armInjectionPoints?.[provider];
  assert(injectionPoint === 'pre-commit' || injectionPoint === 'post-commit',
    `environment does not declare a valid injection point for ${provider}`);
  return { environment, injectionPoint, profile, profileName: citation.profile, windows };
}

function assertJsonEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const error = new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    error.code = 'ZERO_BAKEOFF_ASSERTION_FAILED';
    throw error;
  }
}

export function createArmSuite({app, provider, manifest, evidencePath}) {
  const results = [];
  const expected = new Set(manifest.checks);
  const cleanups = [];

  const record = async (id, outcome, fn, details = {}) => {
    if (!expected.has(id)) throw new Error(`ZERO_BAKEOFF_UNKNOWN_CHECK: ${id}`);
    if (results.some((entry) => entry.id === id)) throw new Error(`ZERO_BAKEOFF_DUPLICATE_CHECK: ${id}`);
    const started = performance.now();
    try {
      const value = fn ? await fn() : undefined;
      results.push({id, outcome, durationMs: performance.now() - started, details, value});
      return value;
    } catch (error) {
      results.push({
        id,
        outcome: 'fail',
        durationMs: performance.now() - started,
        details: {
          ...details,
          code: error?.diagnostic?.code ?? error?.code ?? 'UNCLASSIFIED',
          message: String(error?.message ?? error)
        }
      });
      return undefined;
    }
  };

  return {
    cleanup(fn) {
      cleanups.push(fn);
    },
    pass(id, fn, details) {
      return record(id, 'pass', fn, details);
    },
    gap(id, reason, details = {}) {
      return record(id, 'gap', null, {reason, ...details});
    },
    fail(id, reason, details = {}) {
      return record(id, 'fail', async () => {
        const error = new Error(reason);
        error.code = details.code ?? 'ZERO_BAKEOFF_PRODUCT_FAILURE';
        throw error;
      }, details);
    },
    async finish(extra = {}) {
      const cleanupErrors = [];
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          cleanupErrors.push({code: error?.code ?? 'CLEANUP_FAILED', message: String(error?.message ?? error)});
        }
      }
      const missing = manifest.checks.filter((id) => !results.some((entry) => entry.id === id));
      const counts = Object.fromEntries(['pass', 'gap', 'fail'].map((kind) => [
        kind,
        results.filter((entry) => entry.outcome === kind).length
      ]));
      const receipt = {
        schemaVersion: 'snapback.zero-bakeoff.arm-receipt.v1',
        observedAt: new Date().toISOString(),
        app,
        provider,
        expectedChecks: manifest.expectedChecks,
        executedChecks: results.length,
        counts,
        missing,
        cleanup: {ok: cleanupErrors.length === 0, errors: cleanupErrors},
        ok: missing.length === 0 && counts.fail === 0 && cleanupErrors.length === 0,
        results,
        ...extra
      };
      if (evidencePath) {
        await mkdir(dirname(evidencePath), {recursive: true});
        await writeFile(evidencePath, JSON.stringify(receipt, null, 2) + '\n');
      }
      return receipt;
    }
  };
}

export function assert(condition, message, code = 'ZERO_BAKEOFF_ASSERTION_FAILED') {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

export function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    const error = new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    error.code = 'ZERO_BAKEOFF_ASSERTION_FAILED';
    throw error;
  }
}

export async function eventually(fn, {
  timeoutMs = 5_000,
  intervalMs = 25,
  label = 'condition'
} = {}) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  while (performance.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  const error = new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
  error.code = 'ZERO_BAKEOFF_TIMEOUT';
  throw error;
}
