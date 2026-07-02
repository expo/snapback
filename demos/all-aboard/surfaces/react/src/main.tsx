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
import { setConnection, setDelayRows, setFeedRows, setLocation } from './store.ts';

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

function watchLocation(): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    setLocation(null, 'unavailable');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'device'),
    (err) => setLocation(null, err.code === 1 ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 10_000 },
  );
}

// D4 edits 1-3 (LLP 0034 §5): mount lifecycle = connect + health +
// inspect-only provisioning check; provision and seed run ONLY when inspection
// says they are needed (schema/bundle hash mismatch; empty schedule tables);
// seed-if-empty, never reset-then-seed; the destructive reset is not reachable
// from this path.
async function ensureProvisioned(client: SnapbackClient): Promise<string[]> {
  const actions: string[] = [];
  const inspect = (await client.inspect()) as {
    schema?: { schemaHash?: string | null };
    functions?: { bundleHash?: string | null };
  };

  if (inspect.schema?.schemaHash !== (schemaManifest as { schemaHash: string }).schemaHash) {
    status('Provisioning schema (backend not provisioned for this manifest)…');
    await client.loadSchema(schemaManifest);
    actions.push('schema');
  }
  if (inspect.functions?.bundleHash !== (functionsManifest as { bundleHash: string }).bundleHash) {
    status('Provisioning functions…');
    await client.loadFunctions(functionsManifest);
    actions.push('functions');
  }

  // Seed-if-empty: the static schedule is the seeded-state marker. On an
  // already-provisioned backend with data this is a read, never a write.
  const stations = await client.query('stationsQuery', {});
  if ((stations.rows?.length ?? 0) === 0) {
    status('Seeding the schedule (empty backend)…');
    await client.seed(seed);
    actions.push('seed');
  }
  return actions;
}

async function boot(): Promise<{ provisioned: string[]; connections: () => Record<string, string | null> }> {
  status('Connecting to Snapback…');
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();

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
  watchLocation();

  status('Mounting…');
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');
  const refresh = () => {
    client.mutate('applyFeedTick', { args: { trigger: 'manual' } }).catch((error: unknown) => {
      console.warn('[all-aboard-react] refresh failed', error);
    });
  };
  reactRoot = createRoot(rootEl);
  reactRoot.render(
    <StrictMode>
      <App onRefresh={refresh} />
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
    if (disposeGestures) disposeGestures();
    for (const handle of liveHandles) handle.dispose();
    liveHandles = [];
    reactRoot?.unmount();
    reactRoot = null;
  });
}
