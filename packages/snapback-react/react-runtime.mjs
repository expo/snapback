// Failure-only and development-only React runtime helpers. Keeping these
// behind literal dynamic imports prevents diagnostics and retry machinery
// from riding the successful provider entry closure.

import {
  LIVE_RECONNECT_BASE_DELAY_MS,
  LIVE_RECONNECT_MAX_DELAY_MS,
} from '@expo/snapback-client';

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
