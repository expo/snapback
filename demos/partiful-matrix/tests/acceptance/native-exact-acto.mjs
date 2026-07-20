import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const [platform = 'mac', backend = 'sqlite'] = process.argv.slice(2);
const origin = process.env.EXACT_DEV_URL ?? 'http://127.0.0.1:8083';
const token = process.env.EXACT_AGENT_TOKEN;
const expectedTokenFingerprint = token
  ? createHash('sha256').update(token).digest('hex').slice(0, 16)
  : null;
const agentBase = `${origin}/__exact/agent`;
const discoveryTimeoutMs = Number(process.env.PARTITIME_ACTO_DISCOVERY_TIMEOUT_MS ?? 120_000);
const receipt = {
  schemaVersion: 'partitime.native-exact-acto-cell.v1',
  platform,
  backend,
  ok: false,
  checks: [],
  transientRetries: [],
  actionReceipts: [],
};

function checked(name, predicate, message) {
  assert.ok(predicate, message);
  receipt.checks.push({ name, ok: true });
}

async function json(path, init = {}, { maxAttempts = 5 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${agentBase}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
      const text = await response.text();
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        throw Object.assign(
          new Error(`${path}: ${response.status} non-JSON response: ${text.slice(-1_000)}`),
          { retryable: response.status >= 500, status: response.status },
        );
      }
      if (!response.ok || value.error) {
        throw Object.assign(
          new Error(`${path}: ${response.status} ${JSON.stringify(value.error ?? value)}`),
          { retryable: response.status >= 500, status: response.status },
        );
      }
      return value;
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable !== false;
      if (!retryable || attempt === maxAttempts) throw error;
      receipt.transientRetries.push({ path, attempt, status: error?.status ?? null });
      await new Promise((resolveWait) => setTimeout(resolveWait, 250 * attempt));
    }
  }
  throw lastError;
}

try {
  const deadline = Date.now() + discoveryTimeoutMs;
  let candidates = [];
  let lastTargets = [];
  let stableCandidateKey = null;
  let stableCandidateObservations = 0;
  while (Date.now() < deadline) {
    try {
      const targets = await json('/targets');
      lastTargets = targets.targets ?? [];
      candidates = lastTargets.filter((target) =>
        target.live &&
        target.platform === platform &&
        target.agentUrl &&
        target.tokenFingerprint === expectedTokenFingerprint &&
        Number.isSafeInteger(target.generation) &&
        target.generation > 0 &&
        target.hostStatus?.phase === 'rendered' &&
        target.hostStatus?.load?.state === 'completed'
      );
      if (candidates.length === 1) {
        const candidate = candidates[0];
        const key = `${candidate.targetId}:${candidate.generation}`;
        if (key === stableCandidateKey) {
          stableCandidateObservations += 1;
        } else {
          stableCandidateKey = key;
          stableCandidateObservations = 1;
        }
        // A rendered host can publish before the JS agent finishes its final
        // ephemeral-port rebind. Four consecutive relay observations keep the
        // later generation pin meaningful without guessing a fixed port.
        if (stableCandidateObservations >= 4) break;
      } else {
        stableCandidateKey = null;
        stableCandidateObservations = 0;
      }
    } catch {
      // The relay may not be ready when the carrier starts. Preserve only the
      // final error below; transient bearer-token/readiness races are expected.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  receipt.observedTargets = lastTargets.map((target) => ({
    targetId: target.targetId ?? null,
    platform: target.platform ?? null,
    live: target.live === true,
    hasAgentUrl: Boolean(target.agentUrl),
    tokenFingerprintMatched: target.tokenFingerprint === expectedTokenFingerprint,
    generation: target.generation ?? null,
    hostStatus: target.hostStatus ?? null,
  }));
  assert.equal(
    candidates.length,
    1,
    `expected one live ${platform} Acto target; observed ${lastTargets.length} total targets`,
  );
  assert.ok(
    stableCandidateObservations >= 4,
    `live ${platform} Acto target did not retain one registration generation for four observations`,
  );
  const target = candidates[0];
  receipt.target = {
    targetId: target.targetId,
    platform: target.platform,
    generation: target.generation ?? null,
    tokenFingerprintMatched: target.tokenFingerprint === expectedTokenFingerprint,
    hostStatus: target.hostStatus ?? null,
    stableReadinessObservations: stableCandidateObservations,
  };
  receipt.checks.push({ name: 'one live Acto target', ok: true });
  const route = (path) => {
    const separator = path.includes('?') ? '&' : '?';
    const generation = target.generation == null
      ? ''
      : `&registrationGeneration=${encodeURIComponent(target.generation)}`;
    return `${path}${separator}target=${encodeURIComponent(target.targetId)}${generation}`;
  };
  const post = (path, body, options) => json(route(path), {
    method: 'POST',
    body: JSON.stringify(body),
  }, options);
  const waitFor = (testId) => post('/wait', {
    condition: 'viewExists',
    params: { testId },
    timeout: 10_000,
  });
  const waitForNativeTarget = async (testId) => {
    const deadline = Date.now() + 10_000;
    let attempts = 0;
    let last = null;
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        last = await post('/native-hit-test', {
          target: { testId },
          point: 'center',
        }, { maxAttempts: 1 });
        const data = last.data ?? {};
        const semanticViewId = data.semanticTarget?.viewId ?? null;
        const semanticTargetReached = semanticViewId != null &&
          data.nativeHitPath?.some((entry) => entry.viewId === semanticViewId);
        if (
          data.degraded === false &&
          data.occludedByHigherWindow !== true &&
          semanticTargetReached
        ) {
          return {
            attempts,
            degraded: false,
            occludedByHigherWindow: false,
            semanticViewId,
            semanticTargetReached: true,
            finalTargetTestId: data.finalTarget?.testId ?? null,
            nativeHitPathLength: data.nativeHitPath?.length ?? 0,
          };
        }
      } catch {
        // The read-only native bridge can be unavailable briefly while the
        // freshly launched window becomes key. The mutating tap is never
        // retried; only this preflight is polled.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    const data = last?.data ?? {};
    throw new Error(
      `native hit-test never reached ${testId}: ${JSON.stringify({
        attempts,
        degraded: data.degraded ?? null,
        occludedByHigherWindow: data.occludedByHigherWindow ?? null,
        semanticViewId: data.semanticTarget?.viewId ?? null,
        nativeHitPath: data.nativeHitPath?.map((entry) => ({
          className: entry.className ?? null,
          kind: entry.kind ?? null,
          viewId: entry.viewId ?? null,
          testId: entry.testId ?? null,
          frame: entry.frame ?? null,
        })) ?? [],
        finalTargetTestId: data.finalTarget?.testId ?? null,
      })}`,
    );
  };
  const actionReceipt = (testId, response, preflight) => {
    receipt.actionReceipts.push({
      testId,
      preflight,
      dispatched: response.data?.dispatched === true,
      nativeReachability: response.data?.nativeReachability ?? null,
    });
  };

  let snapshot = await post('/snapshot', {
    include: ['tree', 'diagnostics'],
    treeFormat: 'dense',
  });
  let tree = snapshot.data.tree.tree;
  if (!tree.includes('testId=open-event_swim')) {
    assert.match(tree, /testId=back/, 'expected feed or event detail');
    const backPreflight = await waitForNativeTarget('back');
    const back = await post('/tap', { testId: 'back' }, { maxAttempts: 1 });
    actionReceipt('back', back, backPreflight);
    checked('back action dispatched', back.data.dispatched === true, 'back action did not dispatch');
    checked('feed restored', (await waitFor('open-event_swim')).data.matched === true, 'feed did not restore');
    snapshot = await post('/snapshot', { include: ['tree'], treeFormat: 'dense' });
    tree = snapshot.data.tree.tree;
  }

  checked('backend label rendered', new RegExp(`EXACT \\+ CONTRACT · ${backend}`).test(tree), 'backend label did not render');
  checked('canonical event rendered', /testId=event-title-event_sunset/.test(tree), 'canonical event did not render');
  checked('detail action rendered', /testId=open-event_swim/.test(tree), 'detail action did not render');

  const openPreflight = await waitForNativeTarget('open-event_swim');
  const opened = await post('/tap', {
    testId: 'open-event_swim',
    observeAfter: { include: ['tree'] },
  }, { maxAttempts: 1 });
  actionReceipt('open-event_swim', opened, openPreflight);
  checked('open action dispatched', opened.data.dispatched === true, 'open action did not dispatch');
  checked(
    'open action native-reachable',
    opened.data.nativeReachability?.reachesTarget === true,
    'open action is not reachable through native hit testing',
  );
  checked('detail loaded', (await waitFor('rsvp-going')).data.matched === true, 'detail did not load');

  const detail = await post('/snapshot', { include: ['tree'], treeFormat: 'dense' });
  const wasGoing = detail.data.tree.tree.includes('testId=my-rsvp-going');
  const targetStatus = wasGoing ? 'maybe' : 'going';
  receipt.transition = { before: wasGoing ? 'going' : 'not-going', after: targetStatus };

  const rsvpPreflight = await waitForNativeTarget(`rsvp-${targetStatus}`);
  const responded = await post('/tap', {
    testId: `rsvp-${targetStatus}`,
    observeAfter: { include: ['tree'] },
  }, { maxAttempts: 1 });
  actionReceipt(`rsvp-${targetStatus}`, responded, rsvpPreflight);
  checked('RSVP action dispatched', responded.data.dispatched === true, 'RSVP action did not dispatch');
  checked(
    'RSVP action native-reachable',
    responded.data.nativeReachability?.reachesTarget === true,
    'RSVP action is not reachable through native hit testing',
  );
  checked(
    'RSVP state transitioned',
    (await waitFor(`my-rsvp-${targetStatus}`)).data.matched === true,
    'RSVP did not change state',
  );

  receipt.ok = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify(receipt));
process.exit(receipt.ok ? 0 : 1);
