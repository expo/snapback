// Failure-only and development-only React runtime helpers. Keeping these
// behind literal dynamic imports prevents diagnostics and retry machinery
// from riding the successful provider entry closure.

import {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_DELAY_MS,
  handoffPreparedReactBindingGeneration,
} from '@expo/snapback-client';

const LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS = 5;
let liveHookArgs = null;

// Invoked only after index.mjs positively identifies a development runtime.
// State is keyed by the hook's existing subscription-lease ref, so no extra
// React hook is required and unmounted sites remain weakly held.
export function diagnoseLiveHookArgsIdentity({
  hookRef,
  reference,
  args,
  argsKey,
  site,
}) {
  liveHookArgs ??= new WeakMap();
  const previous = liveHookArgs.get(hookRef) ?? null;
  const changedIdentity = previous !== null && previous.args !== args;
  const sameValue = previous !== null && previous.argsKey === argsKey;
  const consecutiveRenders = changedIdentity && sameValue
    ? previous.consecutiveRenders + 1
    : 0;
  const warned = changedIdentity && sameValue ? previous.warned : false;
  if (consecutiveRenders >= LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS && !warned) {
    const functionName = reference?.name ?? reference?.id ?? String(reference ?? 'unknown');
    console.warn(
      `[Snapback] useSnapbackQuery(${functionName}) received a new args object with unchanged contents for ${LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS} consecutive renders. Memoize the args object at this hook site.`,
      Object.freeze({
        code: 'SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN',
        hook: 'useSnapbackQuery',
        function: functionName,
        consecutiveRenders,
        site,
      }),
    );
  }
  liveHookArgs.set(hookRef, {
    args,
    argsKey,
    consecutiveRenders,
    warned: warned || consecutiveRenders >= LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS,
  });
}

export function triggerControlledDevelopmentReload(failure, developmentHmr) {
  console.error(
    `${failure.code}: ${failure.message} (reason: ${failure.details?.reason ?? 'unknown'}). `
    + 'Snapback is triggering a full dev reload so the mounted provider realigns with the '
    + 'regenerated api module. If no reload mechanism is available on this host, reload '
    + 'manually (press "r" in the Metro terminal or refresh the page).',
  );
  try {
    if (typeof developmentHmr?.onReloadRequired === 'function') {
      developmentHmr.onReloadRequired(failure);
      return;
    }
  } catch { /* observational */ }
  try { globalThis.DevSettings?.reload?.('SNAPBACK_REACT_HMR_REBIND_FAILED'); } catch { /* best effort */ }
  try { globalThis.location?.reload?.(); } catch { /* best effort */ }
}

export async function runDevelopmentHmrHandoff(binding, target, developmentHmr) {
  let outcome;
  try {
    outcome = await handoffPreparedReactBindingGeneration(binding, target, {
      ...(Number.isSafeInteger(developmentHmr?.timeoutMs)
        ? { timeoutMs: developmentHmr.timeoutMs }
        : {}),
      ...(Number.isSafeInteger(developmentHmr?.pollIntervalMs)
        ? { pollIntervalMs: developmentHmr.pollIntervalMs }
        : {}),
    });
  } catch (error) {
    outcome = {
      ok: false,
      reason: 'handoff-error',
      cause: error?.code ?? String(error),
    };
  }
  if (outcome?.ok === true) return outcome;
  const failure = Object.freeze({
    schemaVersion: 'snapback.client-diagnostic.v1',
    code: 'SNAPBACK_REACT_HMR_REBIND_FAILED',
    severity: 'error',
    message: 'HMR delivered regenerated Snapback references, but the mounted provider could not atomically rebind to the new generation',
    details: Object.freeze({
      reason: outcome?.reason ?? 'handoff-error',
      ...(outcome?.cause === undefined ? {} : { cause: outcome.cause }),
    }),
  });
  triggerControlledDevelopmentReload(failure, developmentHmr);
  return {
    ...outcome,
    failure,
  };
}

function projectionEquals(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => projectionEquals(value, right[index]));
  }
  if (
    left === null
    || right === null
    || typeof left !== 'object'
    || typeof right !== 'object'
  ) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => (
      Object.hasOwn(right, key) && projectionEquals(left[key], right[key])
    ));
}

const subscribeRetryAttempts = new WeakMap();

export function resetSubscribeRetry(store) {
  subscribeRetryAttempts.delete(store);
}

export function scheduleSubscribeRetry({ store, shouldRetry, retry }) {
  if (!shouldRetry()) return () => resetSubscribeRetry(store);
  const attempts = subscribeRetryAttempts.get(store) ?? 0;
  const delay = Math.min(
    LIVE_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempts, 30),
    LIVE_RECONNECT_MAX_DELAY_MS,
  );
  subscribeRetryAttempts.set(store, attempts + 1);
  const handle = setTimeout(() => {
    if (shouldRetry()) retry();
  }, delay);
  handle.unref?.();
  return () => {
    clearTimeout(handle);
    resetSubscribeRetry(store);
  };
}

export function handleSubscribeFailure(input) {
  const [
    store, error, generation, handle, clearUnadoptedSubscription,
    allHandles, recoverExpiredRegisteredConnection, publish, serializeError,
    registryActive, retry,
  ] = input;
  if (
    store.retry === null
    || store.generation !== generation
    || store.handle !== handle
  ) return;
  clearUnadoptedSubscription(store);
  store.handle = null;
  allHandles.delete(handle);
  if (error?.code === 'SNAPBACK_REACT_GROUP_ATTACH_EXPIRED') {
    store.retry = null;
    void recoverExpiredRegisteredConnection();
    return;
  }
  publish(store, Object.freeze({
    status: 'error',
    data: undefined,
    error: serializeError(error),
    connection: 'error',
    freshness: 'unknown',
    retention: store.retention,
  }), generation);
  store.retry = scheduleSubscribeRetry({
    store,
    shouldRetry: () => (
      registryActive()
      && !store.handle
      && (store.consumers > 0 || store.pins > 0)
    ),
    retry: () => {
      store.retry = null;
      retry();
    },
  });
}

export function warnIfReplayDivergent({
  replayAdvisoryKeys,
  mutationReference,
  queryReference,
  layer,
  store,
  initialProjection,
  validateResultContract,
}) {
  const key = `${mutationReference.id}\u0000${queryReference.id}`;
  if (replayAdvisoryKeys.has(key)) return;
  let detail = null;
  try {
    const replayed = validateResultContract(
      store.resultContract,
      layer.update(initialProjection, layer.mutationArgs),
      { requireKnown: true },
    );
    if (!projectionEquals(replayed, initialProjection)) {
      detail = 'returned a different projection when replayed over its own output';
    }
  } catch (error) {
    detail = 'failed when replayed over its own output '
      + `(${error?.code ?? error?.message ?? String(error)})`;
  }
  if (detail === null) return;
  replayAdvisoryKeys.add(key);
  console.warn(
    `SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT: the optimistic update for ${mutationReference.name} `
    + `over ${queryReference.name} ${detail}. Optimistic updates are replayable projections over an `
    + 'evolving authoritative base: capture the intended outcome and set it (or use '
    + 'projectRecordFields) instead of toggling or incrementing the incoming rows. See '
    + 'guide/recipes/optimistic-toggle.md.',
  );
}
