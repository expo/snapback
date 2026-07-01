// All Aboard — Contract surface bootstrap (web host).
//
// Boots a Snapback backend, wires the generated applyFeedTick mutation binding,
// keeps store.mjs in sync with the live delays + freshness marker, and feeds the
// device location in (with a default-station fallback when it is denied). The
// .contract then renders from the store on every clock tick — on web here via the
// DOM mirror, and unchanged on native macOS/iOS through the Exact kernel host.

import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import { setDelays, setFeed, setLocation } from './store.mjs';
import app from './app.contract';

const CONNECTION = `all-aboard-${(globalThis.crypto?.randomUUID?.() ?? String(Math.round(performance.now())))}`;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function snapbackBaseUrl(): string {
  const origin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return typeof origin === 'string' && origin.length > 0 ? `${origin}/snapback` : '/snapback';
}

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const el = typeof document !== 'undefined' ? document.getElementById('boot-status') : null;
  if (!el) {
    console.log(`[all-aboard] ${message}`);
    return;
  }
  el.textContent = message;
  el.dataset.state = state;
}

// The generated Contract links. The view drives only applyFeedTick (the manual
// refresh action); the rest satisfy the generated interface. Queries are served
// from the live store, so their links are unused stubs.
function contractLinks(client: SnapbackClient) {
  const mutate = (name: string) => (args: unknown) => client.mutate(name, { args });
  const empty = () => [];
  return {
    applyFeedTick: mutate('applyFeedTick'),
    resetFeed: mutate('resetFeed'),
    liveTrainStatus: empty,
    feedState: empty,
    stationsQuery: empty,
    stopTimesByStation: empty,
    tripsQuery: empty,
  };
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
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();

  status('Loading schedule + recorded feed…');
  await client.loadSchema(schemaManifest);
  await client.loadFunctions(functionsManifest);
  await client.reset();
  await client.seed(seed);
  configureSnapbackContractLinks(contractLinks(client));

  // Live delays: a real subscription (arms the warm-poll cron via whileLive).
  const delaysLive = await client.liveQuery('liveTrainStatus', { connectionId: CONNECTION });
  setDelays(delaysLive.rows);
  setFeed((await client.query('feedState', {})).rows[0]);
  watchLocation();

  // Poll the live delta outbox + freshness marker so cron/manual refreshes appear
  // on screen. The .contract's 1s ticker re-derives from the store each second.
  pollTimer = setInterval(async () => {
    try {
      setDelays(await delaysLive.poll());
      setFeed((await client.query('feedState', {})).rows[0]);
    } catch (error) {
      console.warn('[all-aboard] poll failed', error);
    }
  }, 1500);

  status('Mounting…');
  installContractWebHost();
  mount(app);
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
    resetSnapbackContractLinks();
    reset();
  });
}
