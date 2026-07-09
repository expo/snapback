// All Aboard — static native Exact entry.
//
// The browser entry owns DOM chrome, geolocation prompts, and web gesture glue.
// This entry keeps the native artifact graph Contract-first and avoids pulling
// the web-host renderer into macOS/iOS startup bundles.

import { mount, reset } from '@exact/contract/runtime';

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
import { setDeviceLocation } from './data';
import app from './app.contract';

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
  setDeviceLocation(null, 'unavailable');
  mount(app);
}

const ready = boot();
(globalThis as { allAboard?: unknown }).allAboard = { ready };

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
