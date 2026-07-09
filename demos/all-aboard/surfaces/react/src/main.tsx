// All Aboard — React surface bootstrap (browser host).
//
// The same lifecycle as the Contract arm's main.ts, in React idiom:
//
// - Boot is D4-shaped (LLP 0034 §5): connect + health + inspect-first
//   provisioning — schema/functions load ONLY when inspection says the backend
//   is not provisioned for this manifest, seed ONLY when the schedule tables
//   are empty, and the mount path never calls the destructive reset. A second
//   window's boot therefore cannot clobber the first window's live session
//   (the LLP 0275 C4 footgun).
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
import { setConnection, setDelayRows, setFeedRows, setLocation, setRouteEstimateInvoker } from './store.ts';

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

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const el = document.getElementById('boot-status');
  if (!el) {
    console.log(`[all-aboard-react] ${message}`);
    return;
  }
  el.textContent = message;
  el.dataset.state = state;
  console.log(`[all-aboard-react] ${message}`);
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

// D4 edits 1-3 (LLP 0034 §5): mount lifecycle = connect + health + the single
// idempotent /app/ensure — the server inspects schemaHash/bundleHash/seed
// state and provisions only what is missing, seed-if-empty, never
// reset-then-seed. This is the same boot the Contract surface uses: /app/ensure
// is profile-gated server-side rather than admin-token-gated, so a browser
// page never performs a raw admin write. The previous hand-rolled
// inspect+loadSchema/loadFunctions/seed sequence was admin-token-gated and
// died with SNAPBACK_ADMIN_TOKEN_REQUIRED on any unprovisioned backend
// (ENG-23707).
async function ensureProvisioned(client: SnapbackClient): Promise<string[]> {
  const ensured = await client.ensureApp({
    schema: schemaManifest,
    functions: functionsManifest,
    seed,
  });
  return [
    ensured.schema === 'provisioned' ? 'schema' : null,
    ensured.functions === 'provisioned' ? 'functions' : null,
    ensured.seed === 'seeded' ? 'seed' : null,
  ].filter((action): action is string => action !== null);
}

async function boot(): Promise<{ provisioned: string[]; connections: () => Record<string, string | null> }> {
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

  status('Checking provisioning (inspect-first)…');
  const provisioned = await ensureProvisioned(client);

  status('Subscribing to live train status…');
  // Server push over the shared live socket (LLP 0034 D1): both queries bind
  // on one connection; snapshots arrive with the subscriptions (never a prime
  // race); server-authored deltas (cron ticks, other clients' refreshes)
  // stream into the store with no pump.
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
  void watchLocation();

  status('Mounting…');
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
      <App onRefresh={refresh} onRequestLocation={() => requestDeviceLocation(true)} />
    </StrictMode>,
  );

  // Gesture-first interaction as web surface glue (LLP 0029 G1 in the
  // Contract arm; the same layer here): swipes and arrow keys drive the same
  // press affordances the component tree declares.
  disposeGestures = installGestures(rootEl);
  status('Ready', 'ready');

  const connections = () => ({
    liveTrainStatus: delaysLive.connection ?? null,
    feedState: feedLive.connection ?? null,
  });
  return { provisioned, connections };
}

const ready = boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
  console.error(error);
  throw error;
});

// Test/debug facts: the browser acceptance suite asserts the paved path
// through these (livePush, per-query connection values, the provisioning
// actions this window actually performed) — same shape as the Contract arm.
(globalThis as { allAboard?: unknown }).allAboard = { ready, connection: CONNECTION };
void ready.then(({ provisioned, connections }) => {
  (globalThis as { allAboard?: unknown }).allAboard = {
    ready,
    connection: CONNECTION,
    livePush: true,
    connections,
    provisioned,
  };
}).catch(() => { /* boot failure already surfaced via status */ });

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
