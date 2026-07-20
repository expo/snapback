import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import feedApp from './feed.contract';
import eventApp from './event.contract';
import {
  configureGeneratedProviderLinks,
  resetGeneratedProviderLinks,
  type GeneratedProviderLinks,
} from './data/provider.generated';
import { GatewayContractProvider } from './provider';
import { PERSONAS, type BackendMode } from '../../shared/model';

declare const __MATRIX_BACKEND__: BackendMode;
declare const __SNAPBACK_API_ORIGIN__: string;
declare const __MATRIX_GATEWAY_ORIGIN__: string;
declare const __PARTITIME_DISABLE_POLL_FALLBACK__: boolean;
declare const __CONVEX_URL__: string;

let active: {
  dispose?: () => void | Promise<void>;
  transportEvidence?: () => readonly Record<string, unknown>[];
} | null = null;
const subscriptionEvents: Record<string, unknown>[] = [];

function status(message: string, state: 'booting'|'ready'|'error' = 'booting') {
  const el = document.getElementById('boot-status'); if (el) { el.textContent = message; el.dataset.state = state; }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('user');
  const persona = PERSONAS.find((item) => item.id === requested || item.userId === requested) ?? PERSONAS[0];
  const eventId = params.get('event');
  status(`Connecting Contract to ${__MATRIX_BACKEND__}…`);
  installContractWebHost();

  if (__MATRIX_BACKEND__ === 'snapback') {
    const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
    await client.health();
    // @ref LLP 0034#5 — one idempotent ensure per mount; never reset from a
    // Contract surface, so reload and cross-arm mutations remain observable.
    await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    const surface = await createSnapbackContractSurface({
      runtime: await import('@exact/contract/runtime'), client, userId: persona.userId,
      manifest: contractDataManifest, artifactIndex, schemaManifest, functionManifest: functionsManifest,
      liveQueries: eventId === null ? ['listEvents'] : [
        { name: 'eventDetails', args: { eventId } }, { name: 'guestList', args: { eventId } }, { name: 'eventWall', args: { eventId } },
      ],
      liveFallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
      onSubscriptionEvent: (event: Record<string, unknown>) => subscriptionEvents.push({
        pollFallbackEnabled: !__PARTITIME_DISABLE_POLL_FALLBACK__,
        ...event,
      }),
    });
    active = surface;
    // The stable matrix bindings let one .contract source serve all columns;
    // this cell still delegates to the real generated Snapback surface links.
    configureGeneratedProviderLinks(surface.links as GeneratedProviderLinks);
  } else if (__MATRIX_BACKEND__ === 'convex-realtime') {
    const { ConvexContractProvider } = await import('./convex-provider');
    const provider = new ConvexContractProvider(__CONVEX_URL__, persona.userId);
    active = provider;
    configureGeneratedProviderLinks(provider.links());
  } else {
    const provider = new GatewayContractProvider(__MATRIX_BACKEND__, __MATRIX_GATEWAY_ORIGIN__ || '/matrix-api', persona.userId);
    active = provider;
    configureGeneratedProviderLinks(provider.links() as GeneratedProviderLinks);
  }

  // Preserve the mounted provider as the evidence source even after disposeActive
  // clears the global slot. The provider records its close event during disposal,
  // and the acceptance harness reads that retained evidence afterward.
  const evidenceSource = active;

  if (eventId === null) mount(feedApp, { props: { userName: persona.name, backendName: __MATRIX_BACKEND__ } });
  else mount(eventApp, { props: { eventId, userId: persona.userId, userName: persona.name, backendName: __MATRIX_BACKEND__ } });
  status('Ready', 'ready');
  return {
    backend: __MATRIX_BACKEND__,
    authoring: 'contract',
    transport: __MATRIX_BACKEND__ === 'snapback' || __MATRIX_BACKEND__ === 'convex-realtime' ? 'push' : 'poll',
    screen: eventId ? 'event' : 'feed',
    eventId,
    transportEvidence: () => evidenceSource?.transportEvidence?.().map((event) => ({ ...event }))
      ?? subscriptionEvents.map((event) => ({ ...event })),
    dispose: disposeActive,
  };
}

async function disposeActive() {
  const current = active;
  active = null;
  await current?.dispose?.();
  resetGeneratedProviderLinks();
  reset();
}

const ready = boot().catch((error) => { console.error('[partiful-matrix/contract] boot failed', error); status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error'); throw error; });
(globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;

if (import.meta.hot) import.meta.hot.dispose(() => { void disposeActive(); });
