// All Aboard — React surface bootstrap (browser host).
//
// Same lifecycle as the Contract arm's main.ts: boot a Snapback backend
// (health, schema, functions, reset, seed), open the durable liveTrainStatus
// subscription, poll the live delta outbox + freshness marker into the store,
// and feed the device location in with a default-station fallback. The only
// structural differences are React-shaped: mutations are a direct
// `client.mutate(...)` call handed to the tree as a callback (no generated
// contract-links indirection needed), and rendering is `createRoot`.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '../../../../_kit/client.mjs';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import seed from '../../../snapback/seed.json';
import { App } from './App.tsx';
import { setDelays, setFeed, setLocation } from './store.ts';

const CONNECTION = `all-aboard-react-${(globalThis.crypto?.randomUUID?.() ?? String(Math.round(performance.now())))}`;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const el = document.getElementById('boot-status');
  if (!el) {
    console.log(`[all-aboard-react] ${message}`);
    return;
  }
  el.textContent = message;
  el.dataset.state = state;
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

async function boot(): Promise<void> {
  status('Connecting to Snapback…');
  const client = new SnapbackClient('/snapback');
  await client.health();

  status('Loading schedule + recorded feed…');
  await client.loadSchema(schemaManifest);
  await client.loadFunctions(functionsManifest);
  await client.reset();
  await client.seed(seed);

  // Live delays: a real subscription (arms the warm-poll cron via whileLive).
  const delaysLive = await client.liveQuery('liveTrainStatus', { connectionId: CONNECTION });
  setDelays(delaysLive.rows);
  setFeed((await client.query('feedState', {})).rows[0]);
  watchLocation();

  // Poll the live delta outbox + freshness marker so cron/manual refreshes
  // appear on screen; useSyncExternalStore re-renders the tree on each write.
  pollTimer = setInterval(async () => {
    try {
      setDelays(await delaysLive.poll());
      setFeed((await client.query('feedState', {})).rows[0]);
    } catch (error) {
      console.warn('[all-aboard-react] poll failed', error);
    }
  }, 1500);

  status('Mounting…');
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');
  const refresh = () => {
    client.mutate('applyFeedTick', { args: { trigger: 'manual' } }).catch((error: unknown) => {
      console.warn('[all-aboard-react] refresh failed', error);
    });
  };
  createRoot(rootEl).render(
    <StrictMode>
      <App onRefresh={refresh} />
    </StrictMode>,
  );
  status('Ready', 'ready');
}

const ready = boot().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
  console.error(error);
  throw error;
});

(globalThis as { allAboard?: unknown }).allAboard = { ready, connection: CONNECTION };

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
}
