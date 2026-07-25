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
  scrollReceipts: [],
  targetStatusHistory: [],
};

const lastTargetStatusKey = new Map();

function recordTargetStatuses(targets) {
  for (const target of targets) {
    if (
      target.live !== true ||
      target.platform !== platform ||
      target.tokenFingerprint !== expectedTokenFingerprint
    ) {
      continue;
    }
    const status = target.hostStatus ?? null;
    const key = JSON.stringify({
      generation: target.generation ?? null,
      sequence: status?.sequence ?? null,
      phase: status?.phase ?? null,
      statusText: status?.statusText ?? null,
      loadState: status?.load?.state ?? null,
      loadLabel: status?.load?.label ?? null,
      directPresenterApplyCount:
        status?.presenter?.delivery?.directPresenterApplyCount ?? null,
    });
    if (lastTargetStatusKey.get(target.targetId) === key) continue;
    lastTargetStatusKey.set(target.targetId, key);
    receipt.targetStatusHistory.push({
      observedAt: new Date().toISOString(),
      targetId: target.targetId ?? null,
      generation: target.generation ?? null,
      sequence: status?.sequence ?? null,
      phase: status?.phase ?? null,
      statusText: status?.statusText ?? null,
      loadState: status?.load?.state ?? null,
      loadLabel: status?.load?.label ?? null,
      directPresenterApplyCount:
        status?.presenter?.delivery?.directPresenterApplyCount ?? null,
    });
  }
}

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
          {
            retryable: response.status >= 500,
            status: response.status,
            responseError: value.error ?? null,
            currentGeneration: value.currentGeneration ?? null,
            targetId: value.targetId ?? null,
          },
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
      recordTargetStatuses(lastTargets);
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
  let target = candidates[0];
  const recordTarget = (observations) => {
    receipt.target = {
      targetId: target.targetId,
      platform: target.platform,
      generation: target.generation ?? null,
      tokenFingerprintMatched: target.tokenFingerprint === expectedTokenFingerprint,
      hostStatus: target.hostStatus ?? null,
      stableReadinessObservations: observations,
    };
  };
  recordTarget(stableCandidateObservations);
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
  const refreshReadGeneration = async (path, staleError) => {
    const previousGeneration = target.generation;
    if (
      staleError?.responseError === 'STALE_TARGET_GENERATION' &&
      staleError?.targetId === target.targetId &&
      Number.isSafeInteger(staleError?.currentGeneration) &&
      staleError.currentGeneration > 0 &&
      staleError.currentGeneration !== previousGeneration
    ) {
      // The 409 is issued by the relay that owns the registration map and
      // carries its authoritative current generation. Re-pin only the
      // read-only request; the retry itself revalidates the advertised value.
      target = { ...target, generation: staleError.currentGeneration };
      recordTarget(0);
      receipt.transientRetries.push({
        path,
        attempt: 1,
        status: 409,
        code: 'STALE_TARGET_GENERATION',
        fromGeneration: previousGeneration,
        toGeneration: target.generation,
        generationAuthority: 'relay-409-currentGeneration',
      });
      return;
    }
    const deadline = Date.now() + 15_000;
    let stableKey = null;
    let stableObservations = 0;
    while (Date.now() < deadline) {
      const targets = await json('/targets');
      recordTargetStatuses(targets.targets ?? []);
      const matches = (targets.targets ?? []).filter((candidate) =>
        candidate.live &&
        candidate.targetId === target.targetId &&
        candidate.platform === platform &&
        candidate.agentUrl &&
        candidate.tokenFingerprint === expectedTokenFingerprint &&
        Number.isSafeInteger(candidate.generation) &&
        candidate.generation > previousGeneration &&
        candidate.hostStatus?.phase === 'rendered' &&
        candidate.hostStatus?.load?.state === 'completed'
      );
      if (matches.length === 1) {
        const candidate = matches[0];
        const key = `${candidate.targetId}:${candidate.generation}`;
        stableObservations = key === stableKey ? stableObservations + 1 : 1;
        stableKey = key;
        if (stableObservations >= 4) {
          target = candidate;
          recordTarget(stableObservations);
          receipt.transientRetries.push({
            path,
            attempt: 1,
            status: 409,
            code: 'STALE_TARGET_GENERATION',
            fromGeneration: previousGeneration,
            toGeneration: target.generation,
          });
          return;
        }
      } else {
        stableKey = null;
        stableObservations = 0;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    throw new Error(
      `${path}: stale target generation ${previousGeneration} did not advance stably for ${target.targetId}`,
    );
  };
  const postRead = async (path, body, options) => {
    for (let generationAttempt = 1; generationAttempt <= 3; generationAttempt += 1) {
      try {
        return await post(path, body, options);
      } catch (error) {
        const staleGeneration = error?.status === 409 &&
          /STALE_TARGET_GENERATION/.test(error?.message ?? '');
        if (!staleGeneration || generationAttempt === 3) throw error;
        await refreshReadGeneration(path, error);
      }
    }
    throw new Error(`${path}: exhausted target-generation rediscovery`);
  };
  const waitFor = (testId) => postRead('/wait', {
    condition: 'viewExists',
    params: { testId },
    timeout: 10_000,
  });
  const scrollTargetIntoView = async (testId) => {
    // @ref LLP 0063#sequence — Step 0 freezes native reachability against
    // the physical carrier, independent of persisted host-window geometry.
    const response = await post('/host-scroll', {
      testId: 'partitime-root',
      scrollToVisible: {
        testId,
        padding: { top: 16, bottom: 16, left: 16, right: 16 },
      },
      waitForIdle: true,
    }, { maxAttempts: 1 });
    assert.equal(response.data?.settled, true, `host scroll did not settle for ${testId}`);
    receipt.scrollReceipts.push({
      testId,
      offset: response.data?.offset ?? null,
      contentSize: response.data?.contentSize ?? null,
      scrollGeneration: response.data?.scrollGeneration ?? null,
      settled: response.data?.settled === true,
    });
  };
  const waitForNativeTarget = async (testId) => {
    // A frozen native workload must not depend on the developer's persisted
    // macOS window geometry. Reveal each control through the physical host
    // scroll bridge before asking whether a user event can reach it.
    await scrollTargetIntoView(testId);
    const deadline = Date.now() + 10_000;
    let attempts = 0;
    let last = null;
    while (Date.now() < deadline) {
      attempts += 1;
      try {
        last = await postRead('/native-hit-test', {
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
        coordinates: data.coordinates ?? null,
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

  let snapshot = await postRead('/snapshot', {
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
    snapshot = await postRead('/snapshot', { include: ['tree'], treeFormat: 'dense' });
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

  const detail = await postRead('/snapshot', { include: ['tree'], treeFormat: 'dense' });
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
