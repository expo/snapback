// All Aboard — React surface bootstrap (browser host).
//
// The same lifecycle as the Contract arm's main.ts, in React idiom:
//
// - Startup is board-first (ENG-23727): the App renders immediately from the
//   deterministic schedule shipped in the bundle — first paint is already a
//   useful train board, never a boot/provision/connect sequence. Backend work
//   (health, inspect-first provisioning, live-subscribe) runs BEHIND the board
//   and streams rows into the store when it lands; the store's backendState
//   keeps the board's status note honest meanwhile.
// - The backend phase is still D4-shaped (LLP 0034 §5): connect + health +
//   inspect-first provisioning — schema/functions load ONLY when inspection
//   says the backend is not provisioned for this manifest, seed ONLY when the
//   schedule tables are empty, and the mount path never calls the destructive
//   reset. A second window's boot therefore cannot clobber the first window's
//   live session (the LLP 0275 C4 footgun).
// - Live data is SERVER PUSH: two kit `liveQuery` handles (liveTrainStatus +
//   feedState) on one shared connection with transport 'stream' (LLP 0034 D1)
//   write rows + connection values into the store; there is no poll pump. The
//   Contract arm gets the same wiring from createSnapbackContractSurface; here
//   the two handles are wired by hand (~20 lines) because React has no
//   generated binding layer — that difference is the arms' difference.
// - Mutations are a direct `client.mutate(...)` call handed to the tree as a
//   callback; rendering is `createRoot`; gestures install over `#root`.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '../../../../_kit/client.mjs';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import seed from '../../../snapback/seed.json';
import { App } from './App.tsx';
import { installGestures } from './gestures.ts';
import { setBackendState, setConnection, setDelayRows, setFeedRows, setLocation, setRouteEstimateInvoker } from './store.ts';

const CONNECTION = `all-aboard-react-${(globalThis.crypto?.randomUUID?.() ?? String(Math.round(performance.now())))}`;

// The kit client is untyped .mjs; declare the slice of the liveQuery handle
// this surface consumes (LLP 0034 D1 stream transport).
interface LiveHandle {
  rows: unknown[];
  readonly connection: string;
  dispose: () => void;
}
type LiveQueryFn = (
  name: string,
  options: {
    connectionId: string;
    transport: 'stream';
    onUpdate: (rows: unknown[]) => void;
    onConnectionChange: (value: string) => void;
  },
) => Promise<LiveHandle>;

let liveHandles: LiveHandle[] = [];
let disposeGestures: (() => void) | null = null;
let reactRoot: ReturnType<typeof createRoot> | null = null;

// Startup timing (ENG-23727 acceptance): all values are ms since timeOrigin
// (performance.now() epoch). The board paint must never wait on the backend
// milestones — same shape as the Contract arm's main.ts.
const timing: {
  htmlReceivedMs: number | null;
  scriptStartMs: number;
  usefulBoardCommittedMs: number | null;
  firstBoardPaintMs: number | null;
  backendConnectedMs: number | null;
  liveDataAppliedMs: number | null;
} = {
  htmlReceivedMs: (() => {
    const nav = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
    return nav ? nav.responseEnd : null;
  })(),
  scriptStartMs: performance.now(),
  usefulBoardCommittedMs: null,
  firstBoardPaintMs: null,
  backendConnectedMs: null,
  liveDataAppliedMs: null,
};

const logTiming = (label: string, at: number | null) => {
  console.log(`[all-aboard-react] ${label} at ${at === null ? '?' : Math.round(at)}ms`);
};

let resolveFirstBoardPaint!: () => void;
const firstBoardPaintReady = new Promise<void>((resolvePaint) => {
  resolveFirstBoardPaint = resolvePaint;
});
let usefulBoardCommitObserved = false;

function markUsefulBoardCommitted(): void {
  if (usefulBoardCommitObserved) return;
  usefulBoardCommitObserved = true;
  timing.usefulBoardCommittedMs = performance.now();
  logTiming('useful board committed', timing.usefulBoardCommittedMs);
  const markAfterPaint = () => {
    if (timing.firstBoardPaintMs !== null) return;
    // This is the second rAF callback. The browser had a complete rendering
    // opportunity after the first callback, so the useful committed board has
    // crossed a paint boundary before backend work is released. Record the
    // callback observation on the same monotonic clock as the commit witness.
    timing.firstBoardPaintMs = performance.now();
    logTiming('first board paint', timing.firstBoardPaintMs);
    resolveFirstBoardPaint();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(markAfterPaint));
  } else {
    markAfterPaint();
  }
}

// Build-time API origin injected by vite.config.ts `define`.
declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  // Prefer the direct API origin (live WebSocket + HTTP under loopback CORS;
  // the bun-vite proxy cannot complete WebSocket upgrades — see
  // vite.config.ts). Fall back to the /snapback proxy path when absent.
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  return '/snapback';
}

// The only visible startup chrome is a hard-failure notice (ENG-23727):
// progress never blocks the board, so there is nothing to show on the happy
// path — degraded backends surface through the board's own status note.
function showBootError(message: string): void {
  console.error(`[all-aboard-react] ${message}`);
  const el = document.getElementById('boot-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.state = 'error';
}

// A press-driven retry asks for a fresh fix (maximumAge 0): the user is
// explicitly saying "locate me now", so a stale cached position won't do.
// Boot keeps the 60s cache for a fast first paint.
function requestDeviceLocation(fresh = false): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setLocation(null, 'unavailable');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'device'),
    (err) => setLocation(null, err.code === 1 ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: fresh ? 0 : 60_000, timeout: 10_000 },
  );
}

// ENG-22795: one fire-and-forget getCurrentPosition at boot could be
// auto-denied without the user ever seeing a prompt (Chrome's quiet prompt UI;
// a per-origin block inherited from an earlier dev server on this port), and
// the hint dead-ended there. Ask permission-state-first: skip the doomed call
// when access is hard-blocked, request when the browser can still prompt, and
// adopt the real location whenever access is granted — including a later
// site-settings flip, via the permission change event, with no reload. The
// location-hint press (StationCard) re-requests from a user gesture, which
// Chrome's quiet prompt and Safari need before they will show the prompt.
async function watchLocation(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setLocation(null, 'unavailable');
    return;
  }
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    permission.addEventListener('change', () => {
      if (permission.state === 'granted') requestDeviceLocation();
      else setLocation(null, permission.state === 'denied' ? 'denied' : 'default');
    });
    if (permission.state === 'denied') {
      setLocation(null, 'denied');
      return;
    }
  } catch {
    // No Permissions API (older Safari): fall through and just ask.
  }
  requestDeviceLocation();
}

// D4 (LLP 0034 §5): the single idempotent mount-lifecycle ensure — the server
// inspects, provisions only what is missing, and seeds only when the schedule
// tables are empty; the destructive reset is not reachable from this path.
// Same call the Contract arm makes; /app/ensure is profile-gated server-side
// rather than admin-token-gated, so a browser page never performs a raw admin
// write. The previous hand-rolled inspect+loadSchema/loadFunctions/seed
// sequence was admin-token-gated and died with SNAPBACK_ADMIN_TOKEN_REQUIRED
// on any unprovisioned backend (ENG-23707).
async function ensureProvisioned(client: SnapbackClient): Promise<string[]> {
  // The kit client is untyped .mjs (its ensure spec defaults infer as null);
  // assert the call shape here like the other kit seams in this file.
  const ensured = (await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed } as never)) as {
    schema?: string;
    functions?: string;
    seed?: string;
  };
  return [
    ensured.schema === 'provisioned' ? 'schema' : null,
    ensured.functions === 'provisioned' ? 'functions' : null,
    ensured.seed === 'seeded' ? 'seed' : null,
  ].filter((action): action is string => action !== null);
}

// First useful paint: render the App with the store's empty live state — the
// board typesets scheduled departures under the honest status note. Nothing
// here touches the network.
function renderBoard(client: SnapbackClient): void {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');
  const refresh = () => {
    client.action('refreshFeed', { args: { trigger: 'manual' } }).catch((error: unknown) => {
      console.warn('[all-aboard-react] refresh failed', error);
    });
  };
  reactRoot = createRoot(rootEl);
  reactRoot.render(
    <StrictMode>
      <App
        onRefresh={refresh}
        onRequestLocation={() => requestDeviceLocation(true)}
        onUsefulBoardCommit={markUsefulBoardCommitted}
      />
    </StrictMode>,
  );

  // Gesture-first interaction as web surface glue (LLP 0029 G1 in the
  // Contract arm; the same layer here): swipes and arrow keys drive the same
  // press affordances the component tree declares.
  disposeGestures = installGestures(rootEl);
  void watchLocation();
}

// Backend attach, behind the board. Transient failures (server down, network)
// retry on capped backoff while the board keeps showing scheduled departures
// under an honest note.
async function connectBackend(client: SnapbackClient): Promise<{
  provisioned: string[];
  connections: () => Record<string, string | null>;
}> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.health();
      const provisioned = await ensureProvisioned(client);

      // Server push over the shared live socket (LLP 0034 D1): both queries
      // bind on one connection; snapshots arrive with the subscriptions
      // (never a prime race); server-authored deltas (cron ticks, other
      // clients' refreshes) stream into the store with no pump.
      const liveQuery = client.liveQuery.bind(client) as unknown as LiveQueryFn;
      const delaysLive = await liveQuery('liveTrainStatus', {
        connectionId: CONNECTION,
        transport: 'stream',
        onUpdate: (rows) => setDelayRows(rows as never),
        onConnectionChange: (value) => setConnection('liveTrainStatus', value as never),
      });
      const feedLive = await liveQuery('feedState', {
        connectionId: CONNECTION,
        transport: 'stream',
        onUpdate: (rows) => setFeedRows(rows as never),
        onConnectionChange: (value) => setConnection('feedState', value as never),
      });
      liveHandles = [delaysLive, feedLive];
      setDelayRows(delaysLive.rows as never);
      setFeedRows(feedLive.rows as never);
      setConnection('liveTrainStatus', delaysLive.connection as never);
      setConnection('feedState', feedLive.connection as never);
      timing.liveDataAppliedMs = performance.now();
      logTiming('live data applied', timing.liveDataAppliedMs);

      const connections = () => ({
        liveTrainStatus: delaysLive.connection ?? null,
        feedState: feedLive.connection ?? null,
      });
      return { provisioned, connections };
    } catch (error) {
      setBackendState('offline');
      const delayMs = Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4));
      console.warn(`[all-aboard-react] backend connect failed (attempt ${attempt + 1}); retrying in ${delayMs}ms`, error);
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

const ready = (async () => {
  renderBoard(client);
  await firstBoardPaintReady;
  const { provisioned, connections } = await connectBackend(client);
  setBackendState('connected');
  timing.backendConnectedMs = performance.now();
  logTiming('backend connected', timing.backendConnectedMs);
  return { provisioned, connections };
})().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  showBootError(`Boot failed: ${message}`);
  console.error(error);
  throw error;
});

// Test/debug facts: the browser acceptance suite asserts the paved path
// through these (livePush, per-query connection values, the provisioning
// actions this window actually performed) — same shape as the Contract arm,
// plus the ENG-23727 startup timing.
(globalThis as { allAboard?: unknown }).allAboard = { ready, connection: CONNECTION, startupTiming: timing };
void ready.then(({ provisioned, connections }) => {
  (globalThis as { allAboard?: unknown }).allAboard = {
    ready,
    connection: CONNECTION,
    livePush: true,
    connections,
    provisioned,
    startupTiming: timing,
  };
}).catch(() => { /* boot failure already surfaced via showBootError */ });

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    setRouteEstimateInvoker(null);
    if (disposeGestures) disposeGestures();
    for (const handle of liveHandles) handle.dispose();
    liveHandles = [];
    reactRoot?.unmount();
    reactRoot = null;
  });
}
