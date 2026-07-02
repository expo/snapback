// Cursor presence — Contract surface bootstrap (ENG-22479).
//
// Read side through the paved path: the `ephemeral` binding in app.contract
// consumes the generated webCursors descriptor via
// createSnapbackContractSurface; presence arrives over the shared live
// socket. Write side: pointermove glue publishes through the generated
// mutation-shaped webCursorsPublish link (rated `publish` is Exact LLP 0281's
// budget). Boot is D4-shaped: inspect-first ensure, provision-if-missing,
// never reset (LLP 0034 §5; the LLP 0025 second-window rule holds).

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
const PUBLISH_MIN_INTERVAL_MS = 66; // ~15Hz, inside the 20Hz sustained budget

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

let activeSurface: { dispose?: () => void } | null = null;
let removePointerListener: (() => void) | null = null;

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
  // D4-shaped boot (LLP 0034 §5, the All Aboard pattern): inspect-first via
  // the non-destructive ensure (LLP 0025 lineage — a second window's boot
  // must never clear the first window's rooms); PROVISION the schema only
  // when the ensure says the collections are not loaded at all.
  try {
    await client.ensureEphemeralCollections(schemaManifest);
  } catch (error) {
    if ((error as { diagnostic?: { code?: string } })?.diagnostic?.code !== 'SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION') throw error;
    await client.loadSchema(schemaManifest);
    await client.ensureEphemeralCollections(schemaManifest);
  }

  const surface = await createSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    liveQueries: [],
  });
  activeSurface = surface;
  // Subscribe the room before mount so the binding's first snapshot is ready.
  await surface.prewarmEphemeral('webCursors', { roomId: ROOM });
  configureSnapbackContractLinks(surface.links as never);

  installContractWebHost();
  mount(app);

  // Publish glue: throttled pointermove -> the generated publish descriptor.
  const identity = randomIdentity();
  let lastPublish = 0;
  const onPointerMove = (event: PointerEvent) => {
    const now = Date.now();
    if (now - lastPublish < PUBLISH_MIN_INTERVAL_MS) return;
    lastPublish = now;
    void Promise.resolve(
      surface.links.webCursorsPublish({
        roomId: ROOM,
        value: { x: Math.round(event.clientX), y: Math.round(event.clientY), ...identity },
      }),
    ).catch(() => {
      // Rate-limit rejections are the budget working; drop quietly.
    });
  };
  document.addEventListener('pointermove', onPointerMove);
  removePointerListener = () => document.removeEventListener('pointermove', onPointerMove);

  // Test/debug facts: the acceptance suite drives the forced-map proof
  // (LOCAL-ONLY + dispose-restores) through these.
  let ghostHandle: { dispose(): void } | null = null;
  (globalThis as { cursorsWeb?: unknown }).cursorsWeb = {
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
  return surface;
}

const ready = boot().catch((error) => {
  console.error('[cursors-web contract] boot failed', error);
  throw error;
});
(globalThis as { cursorsWebReady?: unknown }).cursorsWebReady = ready;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removePointerListener?.();
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
