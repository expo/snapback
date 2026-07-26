import {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  createProviderQueryHandle,
  type ContractDataProvider,
  type ContractQueryHandle,
} from '@exact/contract/runtime';

import { SnapbackClient } from '../../../../packages/snapback-client/online.mjs';
import { createOnlineSnapbackContractSurface } from '../../../../packages/snapback-contract/online-surface.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import {
  configureGeneratedProviderLinks,
  listEvents,
  resetGeneratedProviderLinks,
  type EventRow,
  type GeneratedProviderLinks,
} from './data/provider.generated';
import { GatewayContractProvider } from './provider';
import { linksForProvider } from './production-hydration';
import {
  PERSONAS,
  type Backend,
  type BackendMode,
} from '../../shared/model';

// @ref LLP 0063#2026-07-23-two-part-subscription-memory-construct — use the
// generated binding and Contract's logical-query registry, with one callback
// and disposer per logical subscriber and no mounted host tree.

declare const __MATRIX_BACKEND__: BackendMode;
declare const __SNAPBACK_API_ORIGIN__: string;
declare const __MATRIX_GATEWAY_ORIGIN__: string;
declare const __PARTITIME_DISABLE_POLL_FALLBACK__: boolean;

interface MemorySurface {
  links: GeneratedProviderLinks;
  provider: ContractDataProvider;
  dispose?(): void | Promise<void>;
}

interface PartitimeMemoryHarness {
  readonly arm: 'contract';
  readonly backend: string;
  start(count: number): Promise<{ count: number; ready: number }>;
  disposeSubscribers(): Promise<void>;
  dispose(): Promise<void>;
  snapshot(): { active: number; ready: number };
}

declare global {
  var partitimeMemoryHarness: PartitimeMemoryHarness | undefined;
  var partitimeMemoryHarnessReady: Promise<PartitimeMemoryHarness> | undefined;
}

async function createSurface(): Promise<MemorySurface> {
  if (__MATRIX_BACKEND__ === 'snapback') {
    const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
    await client.health();
    await client.ensureApp({
      schema: schemaManifest,
      functions: functionsManifest,
      seed,
    });
    return createOnlineSnapbackContractSurface({
      runtime: {
        createBoundaryContractDataProvider,
        createContractMockQueryBoundary,
        createProviderQueryHandle,
      },
      client,
      userId: PERSONAS[0].userId,
      manifest: contractDataManifest,
      artifactIndex,
      schemaManifest,
      functionManifest: functionsManifest,
      liveQueries: ['listEvents'],
      requiredQueries: ['listEvents'],
      liveFallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
    }) as Promise<MemorySurface>;
  }
  if (!['supabase', 'convex', 'sqlite'].includes(__MATRIX_BACKEND__)) {
    throw new Error(`memory-v2 does not admit follow-up backend ${__MATRIX_BACKEND__}`);
  }
  const provider = new GatewayContractProvider(
    __MATRIX_BACKEND__ as Exclude<Backend, 'snapback'>,
    __MATRIX_GATEWAY_ORIGIN__ || '/matrix-api',
    PERSONAS[0].userId,
  );
  return {
    links: linksForProvider(provider),
    provider,
    dispose: () => provider.dispose(),
  };
}

async function boot(): Promise<PartitimeMemoryHarness> {
  const surface = await createSurface();
  configureGeneratedProviderLinks(surface.links);
  let subscriptions: Array<{ dispose(): void }> = [];
  let active = 0;
  let ready = new Set<number>();
  let resolveReady: ((value: { count: number; ready: number }) => void) | null = null;

  const disposeSubscribers = async () => {
    for (const subscription of subscriptions.splice(0)) subscription.dispose();
    active = 0;
    ready = new Set();
    resolveReady = null;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };

  const harness: PartitimeMemoryHarness = {
    arm: 'contract',
    backend: __MATRIX_BACKEND__,
    async start(count) {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new TypeError('subscriber count must be a positive safe integer');
      }
      if (subscriptions.length > 0) {
        throw new Error('Contract memory subscribers are already active');
      }
      active = count;
      ready = new Set();
      const settled = new Promise<{ count: number; ready: number }>((resolve) => {
        resolveReady = resolve;
      });
      for (let index = 0; index < count; index += 1) {
        const handle = listEvents({}) as ContractQueryHandle<EventRow>;
        subscriptions.push(handle.subscribe((rows) => {
          if (rows.length === 0) return;
          ready.add(index);
          if (ready.size === active) {
            resolveReady?.({ count: active, ready: ready.size });
            resolveReady = null;
          }
        }));
      }
      return settled;
    },
    disposeSubscribers,
    async dispose() {
      await disposeSubscribers();
      resetGeneratedProviderLinks();
      await surface.dispose?.();
      document.getElementById('root')?.remove();
      delete globalThis.partitimeMemoryHarness;
    },
    snapshot: () => ({ active, ready: ready.size }),
  };
  globalThis.partitimeMemoryHarness = harness;
  return harness;
}

globalThis.partitimeMemoryHarnessReady = boot();
