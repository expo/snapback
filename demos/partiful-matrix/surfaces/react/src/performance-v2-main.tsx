import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { useSnapbackQuery } from '../../../../../packages/snapback-react/index.mjs';

import type {
  Connection,
  MatrixProvider,
  ProviderDelivery,
  QueryName,
  RsvpRow,
} from '../../../shared/model';
import { createMatrixProvider } from './provider';

// @ref LLP 0063#amendment-a1-2026-07-24--prospective-partitime-v2-correctness-baseline-reset
// — benchmark-only React comparator adapter for the frozen v2 collector.

const EVENT_ID = 'event_sunset';
const USER_ID = 'user_grace';
const API_METHODS = Object.freeze([
  'reset',
  'awaitStable',
  'snapshotCounters',
  'applyCanonicalUpdate',
] as const);

interface CounterSnapshot {
  activeSubscriptions: number;
  deliveryCallbacks: number;
  domPatchRecords: number;
}

interface PerformanceV2Api {
  reset(activeSubscriptions: number): Promise<void>;
  awaitStable(): Promise<CounterSnapshot>;
  snapshotCounters(): CounterSnapshot;
  applyCanonicalUpdate(): Promise<void>;
}

declare global {
  interface Window {
    __partitimePerformanceV2?: PerformanceV2Api;
  }
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const sleep = (milliseconds: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

async function boot() {
  const provider = await createMatrixProvider();
  const root = document.getElementById('root');
  if (!root) throw new Error('PARTITIME_V2_ROOT_MISSING: missing #root');

  let desiredSubscriptions = 0;
  let activeSubscriptions = 0;
  let deliveryCallbacks = 0;
  let domPatchRecords = 0;
  let activityEpoch = 0;
  let armed = false;
  let setSlots: ((slots: number[]) => void) | null = null;

  const observer = new MutationObserver((records) => {
    activityEpoch += 1;
    if (armed) domPatchRecords += records.length;
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  const instrumentedProvider: MatrixProvider = {
    ...provider,
    async subscribe<Row>(
      name: QueryName,
      args: Record<string, unknown>,
      userId: string,
      publish: (
        rows: Row[],
        connection: Connection,
        delivery?: ProviderDelivery,
      ) => void,
    ) {
      let disposed = false;
      const subscription = await provider.subscribe<Row>(
        name,
        args,
        userId,
        (rows, connection, delivery?: ProviderDelivery) => {
          activityEpoch += 1;
          if (armed && delivery?.kind === 'authoritative') deliveryCallbacks += 1;
          publish(rows, connection, delivery);
        },
      );
      // "Active" means a retained provider handle exists. Counting the
      // asynchronous attempt before it resolves lets a rapid reset advance
      // while starts are still in flight, contaminating later teardown.
      activeSubscriptions += 1;
      activityEpoch += 1;
      return {
        rows: subscription.rows,
        dispose() {
          if (disposed) return;
          disposed = true;
          activeSubscriptions -= 1;
          activityEpoch += 1;
          subscription.dispose();
        },
      };
    },
  };

  function Subscriber({ slot }: { slot: number }) {
    const snapshot = useSnapbackQuery<RsvpRow>({
      provider: instrumentedProvider,
      name: 'guestList',
      args: { eventId: EVENT_ID },
      userId: USER_ID,
      // Each benchmark slot represents one independently retained logical
      // subscription. The product adapter correctly deduplicates equal
      // external-store identities, so the metrology surface must give each
      // slot a distinct ownership identity while preserving the same query,
      // actor, and server workload.
      authority: `${USER_ID}:${slot}`,
    });
    const grace = snapshot.rows.find((row) => row.userId === USER_ID);
    return (
      <output
        data-testid={`performance-v2-subscriber-${slot}`}
        data-grace-status={grace?.status ?? 'missing'}
      >
        {slot}:{grace?.status ?? 'missing'}
      </output>
    );
  }

  function BenchmarkRoot() {
    const [slots, updateSlots] = useState<number[]>([]);
    useEffect(() => {
      setSlots = updateSlots;
      return () => { setSlots = null; };
    }, []);
    return <section data-testid="performance-v2-root">{slots.map((slot) => (
      <Subscriber key={slot} slot={slot} />
    ))}</section>;
  }

  const reactRoot = createRoot(root);
  reactRoot.render(<BenchmarkRoot />);

  const snapshotCounters = (): CounterSnapshot => ({
    activeSubscriptions,
    deliveryCallbacks,
    domPatchRecords,
  });

  const waitUntil = async (
    predicate: () => boolean,
    label: string,
    timeoutMilliseconds = 15_000,
  ) => {
    const deadline = performance.now() + timeoutMilliseconds;
    while (!predicate()) {
      if (performance.now() >= deadline) {
        throw new Error(`PARTITIME_V2_TIMEOUT: ${label}`);
      }
      await sleep(10);
    }
  };

  const awaitStable = async (): Promise<CounterSnapshot> => {
    await waitUntil(
      () => activeSubscriptions === desiredSubscriptions
        && root.querySelectorAll('[data-testid^="performance-v2-subscriber-"]').length
          === desiredSubscriptions,
      `active subscriptions did not settle at ${desiredSubscriptions}`,
    );
    let unchangedFrames = 0;
    let lastEpoch = activityEpoch;
    while (unchangedFrames < 3) {
      await frame();
      if (activityEpoch === lastEpoch) unchangedFrames += 1;
      else {
        unchangedFrames = 0;
        lastEpoch = activityEpoch;
      }
    }
    if (!armed) {
      deliveryCallbacks = 0;
      domPatchRecords = 0;
      armed = true;
    }
    return snapshotCounters();
  };

  const api: PerformanceV2Api = {
    async reset(nextCount) {
      if (!Number.isInteger(nextCount) || nextCount < 0) {
        throw new Error('PARTITIME_V2_COUNT_INVALID: count must be a nonnegative integer');
      }
      await waitUntil(() => setSlots !== null, 'React benchmark root did not mount');
      armed = false;
      deliveryCallbacks = 0;
      domPatchRecords = 0;
      desiredSubscriptions = nextCount;
      setSlots!(Array.from({ length: nextCount }, (_, index) => index));
      await frame();
    },
    awaitStable,
    snapshotCounters,
    async applyCanonicalUpdate() {
      if (!armed || activeSubscriptions !== 8) {
        throw new Error('PARTITIME_V2_CANONICAL_PRECONDITION: update requires 8 stable subscriptions');
      }
      const graceStatus = root
        .querySelector<HTMLElement>('[data-testid^="performance-v2-subscriber-"]')
        ?.dataset.graceStatus;
      if (graceStatus !== 'going' && graceStatus !== 'maybe') {
        throw new Error(`PARTITIME_V2_CANONICAL_STATE: unexpected Grace status ${graceStatus}`);
      }
      const before = deliveryCallbacks;
      await instrumentedProvider.mutate(
        'rsvp',
        {
          eventId: EVENT_ID,
          guestName: 'Grace',
          status: graceStatus === 'going' ? 'maybe' : 'going',
        },
        USER_ID,
      );
      await waitUntil(
        () => deliveryCallbacks > before,
        'canonical update produced no authoritative delivery',
      );
    },
  };

  if (Object.keys(api).sort().join('\0') !== [...API_METHODS].sort().join('\0')) {
    throw new Error('PARTITIME_V2_API_INVENTORY: benchmark control API drifted');
  }
  window.__partitimePerformanceV2 = Object.freeze(api);

  addEventListener('pagehide', () => {
    observer.disconnect();
    reactRoot.unmount();
    void provider.dispose?.();
  }, { once: true });
}

void boot().catch((error) => {
  console.error('[partitime/performance-v2/react] boot failed', error);
  throw error;
});
