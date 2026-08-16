// Failure-only and development-only React runtime helpers. Keeping these
// behind literal dynamic imports prevents diagnostics and retry machinery
// from riding the successful provider entry closure.

import {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_DELAY_MS,
  handoffPreparedReactBindingGeneration,
  preparedReactBindingClient,
} from '@expo/snapback-client';

const LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS = 5;
let liveHookArgs = null;

// Invoked only after index.mjs positively identifies a development runtime.
// State is keyed by the hook's existing subscription-lease ref, so no extra
// React hook is required and unmounted sites remain weakly held.
// @ref LLP 0219#consumers-and-compatibility — LLP 0043 M1's identity-churn
// memoization advisory keeps its 5-consecutive-render, warn-once semantics;
// only its delivery moves into the bound client's diagnostics channel, with
// the direct console line preserved as the no-channel fallback.
export function diagnoseLiveHookArgsIdentity({
  hookRef,
  reference,
  args,
  argsKey,
  site,
  diagnosticsChannel = null,
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
    const message = `useSnapbackQuery(${functionName}) received a new args object with unchanged contents for ${LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS} consecutive renders. Memoize the args object at this hook site. See guide/clients/react.md.`;
    let delivered = false;
    try {
      delivered = diagnosticsChannel?.emit?.({
        schemaVersion: 'snapback.client-diagnostic.v2',
        code: 'SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN',
        severity: 'warning',
        subsystem: 'react',
        message,
        details: {
          hook: 'useSnapbackQuery',
          referenceName: functionName,
          consecutiveRenders,
          callSite: typeof site === 'string' ? site.split('\n').slice(1, 3).join(' | ') : undefined,
        },
        site: typeof site === 'string' ? `${functionName}:args-identity` : undefined,
      }) != null;
    } catch { /* the console fallback below must survive diagnostics failure */ }
    if (!delivered) {
      console.warn(
        `[Snapback] ${message}`,
        Object.freeze({
          code: 'SNAPBACK_REACT_LIVE_HOOK_ARGS_IDENTITY_CHURN',
          hook: 'useSnapbackQuery',
          function: functionName,
          consecutiveRenders,
          site,
        }),
      );
    }
  }
  liveHookArgs.set(hookRef, {
    args,
    argsKey,
    consecutiveRenders,
    warned: warned || consecutiveRenders >= LIVE_HOOK_ARGS_CHURN_WARNING_RENDERS,
  });
}

export function triggerControlledDevelopmentReload(
  failure,
  developmentHmr,
  diagnosticsChannel = null,
) {
  const message = `${failure.message} (reason: ${failure.details?.reason ?? 'unknown'}). `
    + 'Snapback is triggering a full dev reload so the mounted provider realigns with the '
    + 'regenerated api module. If no reload mechanism is available on this host, reload '
    + 'manually (press "r" in the Metro terminal or refresh the page).';
  let delivered = false;
  try {
    delivered = diagnosticsChannel?.emit?.({
      schemaVersion: 'snapback.client-diagnostic.v2',
      code: failure.code,
      severity: 'error',
      subsystem: 'react',
      message,
      details: failure.details,
      site: 'react-runtime:hmr-reload',
    }) != null;
  } catch { /* the console fallback below must survive diagnostics failure */ }
  if (!delivered) console.error(`${failure.code}: ${message}`);
  try {
    if (typeof developmentHmr?.onReloadRequired === 'function') {
      developmentHmr.onReloadRequired(failure);
      return;
    }
  } catch { /* observational */ }
  try { globalThis.DevSettings?.reload?.('SNAPBACK_REACT_HMR_REBIND_FAILED'); } catch { /* best effort */ }
  try { globalThis.location?.reload?.(); } catch { /* best effort */ }
}

export async function runDevelopmentHmrHandoff(
  binding,
  target,
  developmentHmr,
  diagnosticsChannel = null,
) {
  if (diagnosticsChannel === null) {
    try { diagnosticsChannel = preparedReactBindingClient(binding).diagnosticsChannel?.() ?? null; }
    catch { diagnosticsChannel = null; }
  }
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
  triggerControlledDevelopmentReload(failure, developmentHmr, diagnosticsChannel);
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
    registryActive, retry, authBlockedSnapshot,
    recordDiagnostic, terminalProtocolRefusal,
  ] = input;
  if (
    store.retry === null
    || store.generation !== generation
    || store.handle !== handle
  ) return;
  clearUnadoptedSubscription(store);
  store.handle = null;
  allHandles.delete(handle);
  const blocked = authBlockedSnapshot();
  if (blocked !== null) {
    store.retry = null;
    store.freshness = 'unknown';
    store.retention = null;
    publish(store, blocked, generation);
    return;
  }
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
  if (terminalProtocolRefusal) {
    // The sentinel blocks startStore for unchanged mounted demand. Releasing
    // the store clears it, so a deliberate remount after configuration repair
    // can establish a fresh subscription.
    store.retry = () => {};
    recordDiagnostic(error);
    return;
  }
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
  diagnosticsChannel,
  providerInstanceId,
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
  // @ref LLP 0219#consumers-and-compatibility — keep LLP 0107's normative
  // once-per-(mutation, query)-pair-per-provider pin; only its delivery
  // surface moves from direct console output into the bound client channel.
  replayAdvisoryKeys.add(key);
  const message = `Optimistic replay rule: the update for ${mutationReference.name} over ${queryReference.name} ${detail}. Optimistic updates are replayable projections over an evolving authoritative base; capture the intended outcome and set it (or use projectRecordFields) instead of toggling or incrementing incoming rows. See guide/recipes/optimistic-toggle.md.`;
  let delivered = false;
  try {
    delivered = diagnosticsChannel?.emit?.({
      schemaVersion: 'snapback.client-diagnostic.v2',
      code: 'SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT',
      severity: 'warning',
      subsystem: 'react',
      message,
      details: {
        mutationReference: mutationReference.name,
        queryReference: queryReference.name,
        observedReplay: detail,
      },
      site: `${providerInstanceId}:${mutationReference.id}:${queryReference.id}`,
    }) != null;
  } catch { /* advisory delivery never owns optimistic settlement */ }
  if (!delivered) {
    console.warn(
      `SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT: the optimistic update for ${mutationReference.name} `
      + `over ${queryReference.name} ${detail}. Optimistic updates are replayable projections over an `
      + 'evolving authoritative base: capture the intended outcome and set it (or use '
      + 'projectRecordFields) instead of toggling or incrementing the incoming rows. See '
      + 'guide/recipes/optimistic-toggle.md.',
    );
  }
}
