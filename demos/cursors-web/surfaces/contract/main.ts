// Cursor presence — Contract surface bootstrap (ENG-22479 / ENG-22524).
//
// Read side through the paved path: the `ephemeral` binding in app.contract
// consumes the generated webCursors descriptor via
// createSnapbackContractSurface; presence arrives over the shared live
// socket. Write side (Exact LLP 0281 stage 0): the pointer stream is a
// value channel declared IN app.contract — pointermove binds the channel,
// the compositor-only transform sink drives the self dot, and the rated
// publish (rate=15, inside the generated sustainedHz=20 budget) feeds the
// mutation-shaped webCursorsPublish descriptor. This file is now pure
// bootstrap: no pointer listeners, no throttle, no publish glue. Boot is
// D4-shaped: inspect-first ensure, provision-if-missing, never reset
// (LLP 0034 §5; the LLP 0025 second-window rule holds).

import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import app from './app.contract';

const ROOM = 'lobby';

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

let activeSurface: { dispose?: () => void } | null = null;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  return '/snapback';
}

function installWebChrome(): void {
  if (typeof document === 'undefined' || document.getElementById('cursors-web-css')) return;
  document.title = 'Cursor presence — Contract';
  const style = document.createElement('style');
  style.id = 'cursors-web-css';
  style.textContent = `
    html, body, #exact-root { height: 100%; margin: 0; }
    body { background: #05070f; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; }
  `;
  document.head.appendChild(style);
}

function randomIdentity(): { name: string; color: string } {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const palette = ['#5e6ad2', '#2fbf71', '#f2994a', '#e14f62', '#2d9cdb', '#bb6bd9'];
  const suffix = Math.floor(Math.random() * 900 + 100);
  return {
    name: params?.get('name') ?? `guest-${suffix}`,
    color: params?.get('color') ?? palette[suffix % palette.length],
  };
}

async function boot() {
  installWebChrome();
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();
  // The single idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527):
  // inspects, provisions only what is missing, never resets — a second
  // window's boot cannot clear the first window's rooms (LLP 0025 rule).
  await client.ensureApp({ schema: schemaManifest });

  const surface = await createSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    liveQueries: [],
    requiredQueries: [],
  });
  activeSurface = surface;
  // Subscribe the room before mount so the binding's first snapshot is ready.
  await surface.prewarmEphemeral('webCursors', { roomId: ROOM });
  configureSnapbackContractLinks(surface.links as never);

  installContractWebHost();
  // Identity enters as ordinary props; the channel's publish payload reads
  // them per tick in the channel lane (LLP 0281 §3.4 normal→transient reads).
  const identity = randomIdentity();
  mount(app, { props: { profileName: identity.name, profileColor: identity.color } });

  // Test/debug facts: the acceptance suite drives the forced-map proof
  // (LOCAL-ONLY + dispose-restores) and reads the channel/publish facts
  // through the same dataflow snapshot the agent surface serves
  // (LLP 0281 §3.5 — live-observable, never replay-asserted). The snapshot
  // reader is dev-only machinery: `getContractDataflowSnapshot` is not in
  // the production runtime entry, so the accessors live in a dev-only
  // observer module loaded behind Vite's compile-time DEV guard (the
  // documented Exact 0.1.7 paved-road split). Production builds keep the
  // rest of the debug facts and simply never grow `channels`/`receipts`.
  let ghostHandle: { dispose(): void } | null = null;
  const cursorsWebFacts: Record<string, unknown> = {
    room: ROOM,
    identity,
    connection: surface.connectionId,
    surface,
    forceGhost: () => {
      ghostHandle?.dispose();
      ghostHandle = surface.provider.forceEphemeralState?.('webCursors', {
        status: 'ready',
        entries: [{
          key: 'ghost',
          value: { x: 80, y: 140, name: 'Ghost (forced)', color: '#f012be' },
          updatedAt: 1,
          sourceClientId: 'ghost',
          self: false,
        }],
      }) ?? null;
      return Boolean(ghostHandle);
    },
    disposeGhost: () => {
      ghostHandle?.dispose();
      ghostHandle = null;
    },
  };
  if (import.meta.env.DEV) {
    // Awaited so the acceptance suite can read channels()/receipts() as soon
    // as `cursorsWebReady` resolves; Vite eliminates this branch (and the
    // observer module) from the production graph at compile time.
    const { attachDataflowFacts } = await import('./contract-dataflow-observer');
    attachDataflowFacts(cursorsWebFacts);
  }
  (globalThis as { cursorsWeb?: unknown }).cursorsWeb = cursorsWebFacts;
  return surface;
}

const ready = boot().catch((error) => {
  console.error('[cursors-web contract] boot failed', error);
  throw error;
});
(globalThis as { cursorsWebReady?: unknown }).cursorsWebReady = ready;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
