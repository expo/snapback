import {
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { createDataClient } from '@expo/snapback-client/data';
import {
  useSnapbackProviderClient,
  useSnapbackProviderData,
} from './implementation.mjs';

// @ref LLP 0255#s54-delivery-methods-and-capability-checks
// @ref LLP 0255#s9-package-doorway-and-generated-typing

const skippedState = Object.freeze({
  status: 'skipped',
  data: undefined,
  error: null,
  connection: 'idle',
  freshness: 'unknown',
  retention: null,
  pendingWrites: Object.freeze([]),
});
const skippedWatch = Object.freeze({
  snapshot: () => skippedState,
  subscribe: () => () => {},
  refresh: async () => {},
  dispose: () => {},
});

function useBoundDataClient() {
  const client = useSnapbackProviderClient();
  const data = useSnapbackProviderData();
  return useMemo(() => createDataClient({ client, data }), [client, data]);
}

function useDataQuery(descriptor) {
  const bound = useBoundDataClient();
  const skipped = descriptor === 'skip';
  const descriptorKey = skipped
    ? 'skip'
    : JSON.stringify([
        descriptor?.normalizedDataQueryId,
        descriptor?.canonicalArgsDigest,
        descriptor?.cursor,
      ]);
  const watch = useMemo(
    () => (skipped ? skippedWatch : bound.watch(descriptor)),
    [bound, descriptorKey, skipped],
  );
  useEffect(() => () => watch.dispose(), [watch]);
  return useSyncExternalStore(watch.subscribe, watch.snapshot, watch.snapshot);
}

const methods = Object.freeze({ useQuery: useDataQuery });

// Resource-builder and imperative method lookup borrow the current provider
// through React context at the access site. The proxy owns neither witnesses
// nor a registry: every value comes from the prepared binding for this render.
const target = {};
export const db = new Proxy(target, {
  get(_target, property) {
    if (property === 'useQuery') return methods.useQuery;
    const bound = useBoundDataClient();
    return bound[property];
  },
  has(_target, property) {
    return property === 'useQuery';
  },
  ownKeys() {
    return ['useQuery'];
  },
  getOwnPropertyDescriptor(_target, property) {
    return property === 'useQuery'
      ? { configurable: true, enumerable: true, value: methods.useQuery, writable: false }
      : undefined;
  },
});
