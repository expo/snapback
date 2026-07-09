// All Aboard — Contract surface bootstrap (web host).
//
// The paved path (LLP 0034 §6 ownership row 3; Exact LLP 0284 §5.3 "Done
// means" item 3): live data reaches the .contract through `query` bindings
// over the generated liveTrainStatus/feedState descriptors, live-bound over
// the shared stream by createSnapbackContractSurface — server push, no
// hand-written liveQuery + poll pump, no store.mjs container (both deleted).
//
// Startup is board-first (ENG-23727): the departure board mounts immediately
// from the deterministic schedule shipped in the bundle — first paint is
// already a useful train board, never a boot/provision/connect sequence.
// Backend work (health, ensure, live-subscribe) runs BEHIND the board through
// deferred links (./deferred-links.ts): the query bindings hold 'pending'
// (the .contract's `loading` arm renders the schedule board with an honest
// status note) until the real surface attaches and live rows stream in.
//
// The backend phase is still D4-shaped (LLP 0034 §5): connect + health +
// inspect-first provisioning — schema/functions load ONLY when inspection
// says the backend is not provisioned for this manifest, seed ONLY when the
// schedule tables are empty, and the mount path never calls the destructive
// reset. A second window's boot therefore cannot clobber the first window's
// live session (the LLP 0275 C4 footgun). Deferring it changes when it runs,
// not what it does.

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
import { createDeferredContractLinks } from './deferred-links';
import { installGestures } from './gestures';
import { setBackendState, setDeviceLocation, setRouteEstimateInvoker } from './data';
import app from './app.contract';

let activeSurface: { dispose?: () => void } | null = null;
let disposeGestures: (() => void) | null = null;
let disposeRefreshAction: (() => void) | null = null;
let disposeLocationRequest: (() => void) | null = null;

// Startup timing (ENG-23727 acceptance): all values are ms since timeOrigin
// (performance.now() epoch) so the acceptance suite can compare them. The
// board paint must never wait on the backend milestones.
const timing: {
  htmlReceivedMs: number | null;
  scriptStartMs: number;
  firstBoardPaintMs: number | null;
  backendConnectedMs: number | null;
  liveDataAppliedMs: number | null;
} = {
  htmlReceivedMs: (() => {
    const nav = typeof performance !== 'undefined'
      ? (performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined)
      : undefined;
    return nav ? nav.responseEnd : null;
  })(),
  scriptStartMs: typeof performance !== 'undefined' ? performance.now() : 0,
  firstBoardPaintMs: null,
  backendConnectedMs: null,
  liveDataAppliedMs: null,
};

const logTiming = (label: string, at: number | null) => {
  console.log(`[all-aboard] ${label} at ${at === null ? '?' : Math.round(at)}ms`);
};

// Kick off the web-host module fetch at module evaluation so awaiting it in
// mountBoard overlaps with everything else instead of serializing.
const webHostReady = typeof document !== 'undefined' ? import('@exact/renderer/web-host') : null;

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
    #boot-status { display: none; position: fixed; left: 16px; bottom: 16px; z-index: 99; max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px; border: 1px solid #b4525f; border-radius: 10px; background: #0d1322;
      color: #ffb3bd; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
    #boot-status[data-state="error"] { display: block; }
  `;
  document.head.appendChild(style);
}

// The only visible startup chrome is a hard-failure notice (ENG-23727):
// progress never blocks the board, so there is nothing to show on the happy
// path — degraded backends surface through the board's own status note.
function showBootError(message: string): void {
  console.error(`[all-aboard] ${message}`);
  if (typeof document === 'undefined') return;
  let el = document.getElementById('boot-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-status';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.state = 'error';
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

// First useful paint: web chrome + web host + mount, nothing else. Every
// query binding is pending (deferred links), so the .contract's loading arm
// already typesets the schedule-data board on this frame.
async function mountBoard(client: SnapbackClient): Promise<void> {
  installWebChrome();
  if (webHostReady) {
    const { installContractWebHost } = await webHostReady;
    installContractWebHost();
  }
  mount(app);
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame((frameMs) => {
      timing.firstBoardPaintMs = frameMs;
      logTiming('first board paint', frameMs);
    });
  } else {
    timing.firstBoardPaintMs = typeof performance !== 'undefined' ? performance.now() : 0;
  }

  // Gesture-first interaction as web surface glue (LLP 0029 G1): swipes and
  // arrow keys drive the same press affordances the .contract declares.
  const rootEl = typeof document !== 'undefined' ? document.getElementById('exact-root') : null;
  if (rootEl) {
    disposeGestures = installGestures(rootEl);
    disposeRefreshAction = installRefreshAction(rootEl, client);
    disposeLocationRequest = installLocationRequest(rootEl);
  }
  void watchLocation();
}

// Backend attach, behind the board: health + the single idempotent
// mount-lifecycle ensure (LLP 0034 §5 / ENG-22527 — the server inspects,
// provisions only what is missing, seeds only when the schedule tables are
// empty) + the generated Contract adapter with live push (LLP 0034 D1).
// Transient failures (server down, network) retry on capped backoff while the
// board keeps showing scheduled departures under an honest note; a structured
// contract diagnostic (stale generated artifacts) is a build defect, not an
// outage, and fails loudly instead of retrying forever.
async function connectBackend(client: SnapbackClient): Promise<{
  provisioned: string[];
  surface: Awaited<ReturnType<typeof createSnapbackContractSurface>>;
}> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.health();
      const ensured = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
      const provisioned = [
        ensured.schema === 'provisioned' ? 'schema' : null,
        ensured.functions === 'provisioned' ? 'functions' : null,
        ensured.seed === 'seeded' ? 'seed' : null,
      ].filter((action): action is string => action !== null);

      const surface = await createSnapbackContractSurface({
        runtime: await import('@exact/contract/runtime'),
        client,
        manifest: contractDataManifest,
        artifactIndex,
        schemaManifest,
        functionManifest: functionsManifest,
        liveQueries: ['liveTrainStatus', 'liveDepartures', 'feedState'],
      });
      return { provisioned, surface };
    } catch (error) {
      if ((error as { diagnostic?: unknown }).diagnostic) throw error;
      setBackendState('offline');
      const delayMs = Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4));
      console.warn(`[all-aboard] backend connect failed (attempt ${attempt + 1}); retrying in ${delayMs}ms`, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const client = new SnapbackClient(snapbackBaseUrl());
setRouteEstimateInvoker(async (args) => {
  const run = await client.action('routeEstimate', { args });
  if (!run?.ok) {
    const message = run?.diagnostic?.message ?? 'routeEstimate action failed';
    throw new Error(message);
  }
  return run.result ?? {};
});

// Deferred links stand in for the adapter until the backend attaches: the
// generated bindings resolve immediately, queries hold 'pending', mutations
// queue. The one links configuration survives for the app's lifetime — the
// shim forwards to the real surface after attach.
const deferredLinks = createDeferredContractLinks({
  queries: Object.entries((contractDataManifest as { queries?: Record<string, { ephemeral?: boolean }> }).queries ?? {})
    .filter(([, descriptor]) => descriptor?.ephemeral !== true)
    .map(([name]) => name),
  mutations: Object.keys((contractDataManifest as { mutations?: Record<string, unknown> }).mutations ?? {}),
});
configureSnapbackContractLinks(deferredLinks.links as never);
deferredLinks.onFirstDelivery(() => {
  timing.liveDataAppliedMs = performance.now();
  logTiming('live data applied', timing.liveDataAppliedMs);
});

const ready = (async () => {
  await mountBoard(client);
  const { provisioned, surface } = await connectBackend(client);
  activeSurface = surface;
  deferredLinks.attach(surface.links as never);
  setBackendState('connected');
  timing.backendConnectedMs = performance.now();
  logTiming('backend connected', timing.backendConnectedMs);
  return { provisioned, surface };
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  showBootError(`Boot failed: ${message}`);
  console.error(error);
  throw error;
});

// Test/debug facts: the browser acceptance suite asserts the paved path
// through these (livePush, per-query connection values, the provisioning
// actions this window actually performed) plus the ENG-23727 startup timing.
(globalThis as { allAboard?: unknown }).allAboard = { ready, startupTiming: timing };
void ready.then(({ surface, provisioned }) => {
  (globalThis as { allAboard?: unknown }).allAboard = {
    ready,
    connection: surface.connectionId,
    livePush: surface.livePush,
    connections: () => surface.connections(),
    provisioned,
    startupTiming: timing,
  };
}).catch(() => { /* boot failure already surfaced via showBootError */ });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (disposeRefreshAction) disposeRefreshAction();
    if (disposeGestures) disposeGestures();
    if (disposeLocationRequest) disposeLocationRequest();
    disposeRefreshAction = null;
    disposeGestures = null;
    disposeLocationRequest = null;
    setRouteEstimateInvoker(null);
    deferredLinks.dispose();
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
