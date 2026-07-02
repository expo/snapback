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
import { installGestures } from './gestures';
import { setDelays, setFeed, setLocation } from './store.mjs';
import app from './app.contract';

const CONNECTION = `all-aboard-${(globalThis.crypto?.randomUUID?.() ?? String(Math.round(performance.now())))}`;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let disposeGestures: (() => void) | null = null;

function snapbackBaseUrl(): string {
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
    body { background: #05070f; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }
    #exact-root { touch-action: manipulation; -webkit-user-select: none; user-select: none; }
    #exact-root input, #exact-root textarea { -webkit-user-select: text; user-select: text; }
    [data-testid="board-content"] { touch-action: none; }
    input::placeholder { color: rgba(255, 255, 255, 0.4); }
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
  installWebChrome();
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

  // Gesture-first interaction as web surface glue (LLP 0029 G1): swipes and
  // arrow keys drive the same press affordances the .contract declares.
  const rootEl = typeof document !== 'undefined' ? document.getElementById('exact-root') : null;
  if (rootEl) disposeGestures = installGestures(rootEl);
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
    if (disposeGestures) disposeGestures();
    resetSnapbackContractLinks();
    reset();
  });
}
