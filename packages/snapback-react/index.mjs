import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  SNAPBACK_EXTERNAL_STORE_PROTOCOL,
  assertExternalStoreCompatibility,
  createExternalQueryStoreRegistry,
  externalStoreIdentity,
} from '@snapback/client/external-store';

// @ref LLP 0012#react-and-expo-requirements — the framework adapter delegates
// lifecycle ownership to the shared external store and uses React's supported
// concurrent-rendering subscription contract.
// @ref LLP 0063#workstream-2--first-class-react-expo-and-vanilla-projections —
// generated React/Expo bindings ship this primitive instead of app-local
// useEffect/useState subscription hooks.

const EMPTY_ROWS = Object.freeze([]);
const providerRegistries = new WeakMap();

function registryFor(provider) {
  let registry = providerRegistries.get(provider);
  if (!registry) {
    registry = createExternalQueryStoreRegistry();
    providerRegistries.set(provider, registry);
  }
  return registry;
}

export function useExternalQueryStore(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

export function useSnapbackQuery({
  provider,
  name,
  args = {},
  userId,
  authority = userId ?? 'default',
  initialRows = EMPTY_ROWS,
  protocol = provider?.externalStoreProtocol,
}) {
  if (!provider || typeof provider.subscribe !== 'function') {
    throw new TypeError('useSnapbackQuery requires a provider.subscribe function');
  }
  assertExternalStoreCompatibility({
    actual: protocol,
    provider: provider.backend ?? provider.name ?? 'snapback',
  });
  const identity = externalStoreIdentity({
    provider: provider.backend ?? provider.name ?? 'snapback',
    query: name,
    args,
    authority,
  });
  const store = useMemo(() => registryFor(provider).get({
    identity,
    initialRows,
    protocol,
    provider: provider.backend ?? provider.name ?? 'snapback',
    start(controller) {
      let latestRows = [...initialRows];
      controller.pending('connecting', latestRows);
      return provider.subscribe(name, args, userId, (rows, connection, delivery = { kind: 'authoritative' }) => {
        if (delivery.kind === 'connection') {
          controller.connection(connection);
          return;
        }
        if (delivery.kind === 'error') {
          controller.error(delivery.error ?? new Error('provider subscription failed'), {
            previous: latestRows,
            connection,
          });
          return;
        }
        latestRows = [...(rows ?? [])];
        controller.ready(latestRows, connection);
      });
    },
  }), [provider, identity, protocol]);
  const snapshot = useExternalQueryStore(store);
  const mutate = useCallback((mutationName, mutationArgs, options) => store.runMutation(
    () => provider.mutate(mutationName, mutationArgs, userId),
    options,
  ), [provider, store, userId]);
  return useMemo(() => Object.freeze({ ...snapshot, mutate, store }), [snapshot, mutate, store]);
}

export { SNAPBACK_EXTERNAL_STORE_PROTOCOL };
