import {
  createProviderMutation,
  createProviderQueryHandle,
  type ContractDataManifest,
  type ContractDataProvider,
  type DataCellV2,
  type DataMutationCorrelation,
  type DataMutationResult,
  type DataObserver,
  type DataSubscription,
} from '@exact/contract/runtime';

import seed from '../../snapback/seed.json';
import type { GeneratedProviderLinks } from './data/provider.generated';

type Seed = typeof seed;

export interface HydrationProviderEvidence {
  seededDeliveries: number;
  underlyingSubscriptions: number;
  bufferedLiveDeliveries: number;
  releasedLiveDeliveries: number;
  hydrationReleased: boolean;
}

function rowsForSeed(queryName: string, args: Record<string, unknown>, value: Seed = seed): readonly unknown[] {
  const eventId = typeof args.eventId === 'string' ? args.eventId : null;
  switch (queryName) {
    case 'listEvents': return value.tables.events;
    case 'eventDetails': return value.tables.events.filter((row) => row._id === eventId);
    case 'guestList': return value.tables.rsvps.filter((row) => row.eventId === eventId);
    case 'eventWall': return value.tables.posts.filter((row) => row.eventId === eventId);
    default: return [];
  }
}

export function createStaticPartitimeProvider(manifest: ContractDataManifest, value: Seed = seed): ContractDataProvider {
  return {
    manifest,
    subscribe<T>(queryName: string, args: Record<string, unknown>, observer: DataObserver<T>): DataSubscription {
      const rows = rowsForSeed(queryName, args, value) as T;
      // The prerendered rows are authoritative, while transport convergence
      // belongs to the browser handoff. Emitting `live` here would bake a
      // connection claim into HTML before any live provider exists.
      observer({ status: 'ready', value: rows, empty: Array.isArray(rows) && rows.length === 0, connection: 'connecting' });
      return { dispose() {} };
    },
    async mutate<T>(_mutationName: string, _args: Record<string, unknown>, _correlation?: DataMutationCorrelation): Promise<DataMutationResult<T>> {
      return { ok: false, error: { message: 'Static Partitime documents do not execute mutations.' } };
    },
  };
}

export function linksForProvider(provider: ContractDataProvider): GeneratedProviderLinks {
  return {
    eventDetails: (args) => createProviderQueryHandle(provider, 'eventDetails', args),
    eventWall: (args) => createProviderQueryHandle(provider, 'eventWall', args),
    guestList: (args) => createProviderQueryHandle(provider, 'guestList', args),
    listEvents: (args) => createProviderQueryHandle(provider, 'listEvents', args),
    createEvent: createProviderMutation(provider, 'createEvent'),
    postMessage: createProviderMutation(provider, 'postMessage'),
    rsvp: createProviderMutation(provider, 'rsvp'),
  };
}

/**
 * Replays the build-time authoritative rows for the adoption turn, then hands
 * the already-established subscription's newest cell to the live tree. This
 * keeps first paint byte-stable without allocating a second live subscription.
 */
export function createHydrationSeededProvider(live: ContractDataProvider, value: Seed = seed): {
  provider: ContractDataProvider;
  release(): void;
  evidence(): HydrationProviderEvidence;
} {
  let hydrationReleased = false;
  let seededDeliveries = 0;
  let underlyingSubscriptions = 0;
  let bufferedLiveDeliveries = 0;
  let releasedLiveDeliveries = 0;
  const pending = new Set<() => void>();

  const provider: ContractDataProvider = {
    manifest: live.manifest,
    subscribe<T>(queryName: string, args: Record<string, unknown>, observer: DataObserver<T>): DataSubscription {
      seededDeliveries += 1;
      const rows = rowsForSeed(queryName, args, value) as T;
      // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
      // build-time snapshot is authoritative data, but it is not evidence
      // that the live provider has converged. Keep the connection axis honest
      // until the already-established underlying subscription reports.
      observer({ status: 'ready', value: rows, empty: Array.isArray(rows) && rows.length === 0, connection: 'connecting' });

      let latest: DataCellV2<T> | null = null;
      let disposed = false;
      underlyingSubscriptions += 1;
      const subscription = live.subscribe<T>(queryName, args, (cell) => {
        if (disposed) return;
        if (!hydrationReleased) {
          latest = cell;
          bufferedLiveDeliveries += 1;
          return;
        }
        if (cell.status === 'pending' || cell.connection === 'connecting') return;
        observer(cell);
      });
      const publishLatest = () => {
        if (disposed || latest === null) return;
        const cell = latest;
        latest = null;
        if (cell.status === 'pending' || cell.connection === 'connecting') return;
        releasedLiveDeliveries += 1;
        observer(cell);
      };
      pending.add(publishLatest);
      return {
        dispose() {
          disposed = true;
          pending.delete(publishLatest);
          subscription.dispose();
        },
      };
    },
  } as ContractDataProvider;
  for (const name of [
    'mutate',
    'getRowSyncState',
    'forceQueryState',
    'subscribeEphemeral',
    'forceEphemeralState',
    'onReceipt',
    'receipts',
  ]) {
    const method = (live as unknown as Record<string, unknown>)[name];
    if (typeof method === 'function') {
      (provider as unknown as Record<string, unknown>)[name] = method.bind(live);
    }
  }

  return {
    provider,
    release() {
      if (hydrationReleased) return;
      hydrationReleased = true;
      for (const publish of pending) publish();
      pending.clear();
    },
    evidence: () => ({
      seededDeliveries,
      underlyingSubscriptions,
      bufferedLiveDeliveries,
      releasedLiveDeliveries,
      hydrationReleased,
    }),
  };
}
