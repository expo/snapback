import {
  mount,
  type ContractDataProvider,
  type DataCellV2,
  type MountHandle,
} from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createOnlineSnapbackContractSurface } from '../../../../packages/snapback-contract/online-surface.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import benchmarkApp from './performance-v2.contract';
import { configureGeneratedProviderLinks } from './data/provider.generated';
import { linksForProvider } from './production-hydration';

// @ref LLP 0063#amendment-a1-2026-07-24--prospective-partitime-v2-correctness-baseline-reset
// — benchmark-only Contract holdout adapter for the frozen v2 collector.

declare const __SNAPBACK_API_ORIGIN__: string;

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
  const root = document.getElementById('exact-root');
  if (!root) throw new Error('PARTITIME_V2_ROOT_MISSING: missing #exact-root');

  const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
  await client.health();
  await client.ensureApp({
    schema: schemaManifest,
    functions: functionsManifest,
    seed,
  });
  const surface = await createOnlineSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    userId: USER_ID,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    liveQueries: [{ name: 'guestList', args: { eventId: EVENT_ID } }],
    requiredQueries: [{ name: 'guestList', args: { eventId: EVENT_ID } }],
    liveFallbackToPoll: false,
  });

  let desiredSubscriptions = 0;
  let activeSubscriptions = 0;
  let deliveryCallbacks = 0;
  let domPatchRecords = 0;
  let activityEpoch = 0;
  let armed = false;
  let mounted: MountHandle | null = null;

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

  const baseProvider = surface.provider as ContractDataProvider;
  const instrumentedProvider: ContractDataProvider = {
    ...baseProvider,
    subscribe<T>(queryName, args, publish) {
      activeSubscriptions += 1;
      activityEpoch += 1;
      let disposed = false;
      const subscription = baseProvider.subscribe<T>(
        queryName,
        args,
        (cell: DataCellV2<T>) => {
          activityEpoch += 1;
          if (armed && cell.status === 'ready') deliveryCallbacks += 1;
          publish(cell);
        },
      );
      return {
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
  configureGeneratedProviderLinks(linksForProvider(instrumentedProvider));

  const host = installContractWebHost({ container: root });
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
      armed = false;
      deliveryCallbacks = 0;
      domPatchRecords = 0;
      desiredSubscriptions = nextCount;
      mounted?.dispose();
      mounted = null;
      root.replaceChildren();
      mounted = mount(benchmarkApp, {
        props: {
          slots: Array.from({ length: nextCount }, (_, index) => index),
        },
      });
      await frame();
    },
    awaitStable,
    snapshotCounters,
    async applyCanonicalUpdate() {
      if (!armed || activeSubscriptions !== 8) {
        throw new Error('PARTITIME_V2_CANONICAL_PRECONDITION: update requires 8 stable subscriptions');
      }
      const text = root
        .querySelector<HTMLElement>('[data-testid^="performance-v2-subscriber-"]')
        ?.textContent ?? '';
      const graceStatus = text.includes(':user_grace:going')
        ? 'going'
        : text.includes(':user_grace:maybe')
          ? 'maybe'
          : null;
      if (graceStatus === null) {
        throw new Error('PARTITIME_V2_CANONICAL_STATE: Grace status is neither going nor maybe');
      }
      const before = deliveryCallbacks;
      const result = await instrumentedProvider.mutate(
        'rsvp',
        {
          eventId: EVENT_ID,
          guestName: 'Grace',
          status: graceStatus === 'going' ? 'maybe' : 'going',
        },
        { effectAttemptId: crypto.randomUUID() },
      );
      if (!result.ok) {
        throw new Error(`PARTITIME_V2_CANONICAL_MUTATION: ${result.error.message}`);
      }
      await waitUntil(
        () => deliveryCallbacks > before,
        'canonical update produced no ready delivery',
      );
    },
  };

  if (Object.keys(api).sort().join('\0') !== [...API_METHODS].sort().join('\0')) {
    throw new Error('PARTITIME_V2_API_INVENTORY: benchmark control API drifted');
  }
  window.__partitimePerformanceV2 = Object.freeze(api);

  addEventListener('pagehide', () => {
    observer.disconnect();
    mounted?.dispose();
    host.dispose();
    surface.dispose();
  }, { once: true });
}

void boot().catch((error) => {
  console.error('[partitime/performance-v2/contract] boot failed', error);
  throw error;
});
