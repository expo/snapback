// All Aboard — Contract surface bootstrap (web host).
//
// The paved path (LLP 0034 §6 ownership row 3; Exact LLP 0284 §5.3 "Done
// means" item 3): live data reaches the .contract through `query` bindings
// over the generated liveTrainStatus/feedState descriptors, live-bound over
// the shared stream by createSnapbackContractSurface — server push, no
// hand-written liveQuery + poll pump, no store.mjs container (both deleted).
//
// Boot is D4-shaped (LLP 0034 §5): connect + health + inspect-first
// provisioning — schema/functions load ONLY when inspection says the backend
// is not provisioned for this manifest, seed ONLY when the schedule tables are
// empty, and the mount path never calls the destructive reset. A second
// window's boot therefore cannot clobber the first window's live session (the
// LLP 0275 C4 footgun).

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
import { installGestures } from './gestures';
import { setDeviceLocation, setRouteEstimateInvoker } from './data';
import app from './app.contract';

let activeSurface: { dispose?: () => void } | null = null;
let disposeGestures: (() => void) | null = null;
let disposeRefreshAction: (() => void) | null = null;
let disposeLocationRequest: (() => void) | null = null;

// Build-time API origin injected by vite.config.ts `define`.
declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  // Prefer the direct API origin (live WebSocket + HTTP under loopback CORS;
  // the bun-vite proxy cannot complete WebSocket upgrades — see
  // vite.config.ts). Fall back to the /snapback proxy path when absent.
  //
  // 'same-origin' is the LLP 0049 deployment hook (§Realtime And Browser
  // Surface): the Cloudflare gateway serves this bundle itself and the
  // generated bindings address the page's own origin — an empty base makes
  // every kit path relative, and the kit resolves its WebSocket URL against
  // the page origin. Build with SNAPBACK_ALL_ABOARD_API=same-origin.
  if (__SNAPBACK_API_ORIGIN__ === 'same-origin') {
    return '';
  }
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  const origin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return typeof origin === 'string' && origin.length > 0 ? `${origin}/snapback` : '/snapback';
}

// The Exact dev server serves its own generated HTML shell (index.html is not
// consulted), so the web-host page chrome lives here: the viewport height
// chain the full-bleed stack needs, the dark backdrop, gesture touch-action
// rules, and text-selection scoping. This is surface glue in the same sense as
// the geolocation and boot-status wiring.
function installWebChrome(): void {
  if (typeof document === 'undefined' || document.getElementById('all-aboard-web-css')) return;
  document.title = 'All Aboard — Caltrain';
  const style = document.createElement('style');
  style.id = 'all-aboard-web-css';
  style.textContent = `
    html, body, #exact-root { height: 100%; margin: 0; }
    body { background: #ffffff; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }
    #exact-root { touch-action: manipulation; -webkit-user-select: none; user-select: none; }
    #exact-root input, #exact-root textarea { -webkit-user-select: text; user-select: text; }
    /* Gesture zones (ENG-23719): the header owns its pointer entirely (station
       swipes); the board keeps native vertical scrolling and yields only the
       horizontal axis to the train-walk gesture (gestures.ts). */
    [data-testid="station-header"] { touch-action: none; }
    [data-testid="board-content"] { touch-action: pan-y; }
    [data-testid="location-hint"], [data-testid="settings-location"] { cursor: pointer; }
    input::placeholder { color: rgba(26, 31, 39, 0.4); }
    #boot-status { position: fixed; left: 16px; bottom: 16px; z-index: 99; max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px; background: #0d1322;
      color: #dbe3f4; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
    #boot-status[data-state="ready"] { display: none; }
    #boot-status[data-state="error"] { border-color: #b4525f; color: #ffb3bd; }
  `;
  document.head.appendChild(style);
}

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  if (typeof document === 'undefined') {
    console.log(`[all-aboard] ${message}`);
    return;
  }
  let el = document.getElementById('boot-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-status';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.state = state;
  console.log(`[all-aboard] ${message}`);
}

// A press-driven retry asks for a fresh fix (maximumAge 0): the user is
// explicitly saying "locate me now", so a stale cached position won't do.
// Boot keeps the 60s cache for a fast first paint.
function requestDeviceLocation(fresh = false): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setDeviceLocation(null, 'unavailable');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setDeviceLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'device'),
    (err) => setDeviceLocation(null, err.code === 1 ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: fresh ? 0 : 60_000, timeout: 10_000 },
  );
}

// ENG-22795: one fire-and-forget getCurrentPosition at boot could be
// auto-denied without the user ever seeing a prompt (Chrome's quiet prompt UI;
// a per-origin block inherited from an earlier dev server on this port), and
// the hint dead-ended there. Ask permission-state-first: skip the doomed call
// when access is hard-blocked, request when the browser can still prompt, and
// adopt the real location whenever access is granted — including a later
// site-settings flip, via the permission change event, with no reload.
async function watchLocation(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setDeviceLocation(null, 'unavailable');
    return;
  }
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    permission.addEventListener('change', () => {
      if (permission.state === 'granted') requestDeviceLocation();
      else setDeviceLocation(null, permission.state === 'denied' ? 'denied' : 'default');
    });
    if (permission.state === 'denied') {
      setDeviceLocation(null, 'denied');
      return;
    }
  } catch {
    // No Permissions API (older Safari): fall through and just ask.
  }
  requestDeviceLocation();
}

// The location-hint press re-runs the geolocation request from a user gesture
// (the .contract's press is intercepted here the same way the refresh button
// is: geolocation is web-surface glue, not contract state).
function installLocationRequest(rootEl: HTMLElement): () => void {
  const listener = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-testid="location-hint"], [data-testid="settings-location"]')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    requestDeviceLocation(true);
  };
  rootEl.addEventListener('click', listener, true);
  return () => rootEl.removeEventListener('click', listener, true);
}

function installRefreshAction(rootEl: HTMLElement, client: SnapbackClient): () => void {
  const listener = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('[data-testid="refresh"]')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    client.action('refreshFeed', { args: { trigger: 'manual' } }).catch((error: unknown) => {
      console.warn('[all-aboard] refreshFeed action failed', error);
    });
  };
  rootEl.addEventListener('click', listener, true);
  return () => rootEl.removeEventListener('click', listener, true);
}

async function boot(): Promise<{ provisioned: string[]; surface: Awaited<ReturnType<typeof createSnapbackContractSurface>> }> {
  installWebChrome();
  status('Connecting to Snapback…');
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();
  setRouteEstimateInvoker(async (args) => {
    const run = await client.action('routeEstimate', { args });
    if (!run?.ok) {
      const message = run?.diagnostic?.message ?? 'routeEstimate action failed';
      throw new Error(message);
    }
    return run.result ?? {};
  });

  // The single idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527):
  // the server inspects, provisions only what is missing, and seeds only
  // when the schedule tables are empty — one call, D4 semantics server-side.
  status('Ensuring backend provisioning…');
  const ensured = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
  const provisioned = [
    ensured.schema === 'provisioned' ? 'schema' : null,
    ensured.functions === 'provisioned' ? 'functions' : null,
    ensured.seed === 'seeded' ? 'seed' : null,
  ].filter((action): action is string => action !== null);

  status('Subscribing to live train status…');
  // The generated Contract adapter with live push (LLP 0034 D1): both live
  // descriptors bind over one shared socket; snapshots arrive with the
  // subscriptions (never a prime race); server-authored deltas (cron ticks,
  // other clients' refreshes) stream into the query bindings with no pump.
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
  void watchLocation();

  status('Mounting…');
  if (typeof document !== 'undefined') {
    const { installContractWebHost } = await import('@exact/renderer/web-host');
    installContractWebHost();
  }
  mount(app);

  // Gesture-first interaction as web surface glue (LLP 0029 G1): swipes and
  // arrow keys drive the same press affordances the .contract declares.
  const rootEl = typeof document !== 'undefined' ? document.getElementById('exact-root') : null;
  if (rootEl) {
    disposeGestures = installGestures(rootEl);
    disposeRefreshAction = installRefreshAction(rootEl, client);
    disposeLocationRequest = installLocationRequest(rootEl);
  }
  status('Ready', 'ready');
  return { provisioned, surface };
}

const ready = boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
  console.error(error);
  throw error;
});

// Test/debug facts: the browser acceptance suite asserts the paved path
// through these (livePush, per-query connection values, the provisioning
// actions this window actually performed).
(globalThis as { allAboard?: unknown }).allAboard = { ready };
void ready.then(({ surface, provisioned }) => {
  (globalThis as { allAboard?: unknown }).allAboard = {
    ready,
    connection: surface.connectionId,
    livePush: surface.livePush,
    connections: () => surface.connections(),
    provisioned,
  };
}).catch(() => { /* boot failure already surfaced via status */ });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (disposeRefreshAction) disposeRefreshAction();
    if (disposeGestures) disposeGestures();
    if (disposeLocationRequest) disposeLocationRequest();
    disposeRefreshAction = null;
    disposeGestures = null;
    disposeLocationRequest = null;
    setRouteEstimateInvoker(null);
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
