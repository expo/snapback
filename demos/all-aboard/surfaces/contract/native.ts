// All Aboard — static native Exact entry.
//
// The browser entry owns DOM chrome and web-only side effects. Exact's native
// host adapter owns device bindings such as geolocation; this entry keeps the
// native artifact graph Contract-first and avoids pulling the web-host renderer
// into macOS/iOS startup bundles.

import { reset } from '@exact/contract/runtime';
import { publishHostState } from '@exact/contract/runtime/host-bindings';
import { ensureAppAgentBootstrap } from '@exact/app-agent-bootstrap';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import { setRouteEstimateTransport } from './data';
import { mountAllAboardRouter, type AllAboardRouterHandle } from './router';

function createApp<T extends Record<string, unknown>>(config: T): T {
  return config;
}

createApp({
  title: 'All Aboard',
  themeColor: '#C8102E',
  viewport: {
    initialScale: 1,
    width: 'device-width',
  },
});

let activeSurface: { dispose?: () => void } | null = null;
let routerHandle: AllAboardRouterHandle | null = null;

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  const origin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return typeof origin === 'string' && origin.length > 0 ? `${origin}/snapback` : '/snapback';
}

async function boot(): Promise<void> {
  const client = new SnapbackClient(snapbackBaseUrl());
  setRouteEstimateTransport(async (args) => {
    const run = await client.action('routeEstimate', { args });
    if (!run?.ok) {
      throw new Error(run?.diagnostic?.message ?? 'routeEstimate action failed');
    }
    return run.result ?? {};
  });
  await client.health();
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });

  const surface = await createSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    liveQueries: ['liveTrainStatus', 'liveDepartures', 'feedState'],
  });
  activeSurface = surface;
  configureSnapbackContractLinks(surface.links as never);
  routerHandle = await mountAllAboardRouter();
  // @ref LLP 0052#d1--reactive-host-state-host-bindings — native projects provider lifecycle through the same declared binding as web.
  publishHostState('backend', { status: 'connected' });
}

const ready = boot();
void ensureAppAgentBootstrap().catch((error: unknown) => {
  console.warn(
    '[All Aboard] native agent bootstrap failed:',
    error instanceof Error ? error.message : String(error),
  );
});
(globalThis as { allAboard?: unknown }).allAboard = {
  ready,
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeSurface?.dispose?.();
    activeSurface = null;
    routerHandle?.dispose();
    routerHandle = null;
    setRouteEstimateTransport(null);
    resetSnapbackContractLinks();
    reset();
  });
}
