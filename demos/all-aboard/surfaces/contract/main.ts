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
// the adapter's render-first mode (ENG-23736): links return synchronously,
// the query bindings hold 'pending' (the .contract's `loading` arm renders
// the schedule board with an honest status note) until the surface attaches
// and live rows stream in. The hand-rolled deferred-links shim this surface
// used to carry is deleted — the adapter owns that behavior now.
//
// The backend phase is still D4-shaped (LLP 0034 §5): connect + health +
// inspect-first provisioning — schema/functions load ONLY when inspection
// says the backend is not provisioned for this manifest, seed ONLY when the
// schedule tables are empty, and the mount path never calls the destructive
// reset. A second window's boot therefore cannot clobber the first window's
// live session (the LLP 0275 C4 footgun). Deferring it changes when it runs,
// not what it does.

import * as contractRuntime from '@exact/contract/runtime';
import { reset } from '@exact/contract/runtime';
import {
  publishHostState,
  publishHostTransaction,
} from '@exact/contract/runtime/host-bindings';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createRenderFirstSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import { installDirections } from './directions';
import { setRouteEstimateTransport } from './data';
import { mountAllAboardRouter, type AllAboardRouterHandle } from './router';
import {
  snapbackTargetClientOptions,
  snapbackWebBaseUrl,
} from './web-target';
import { installTrainSelectionTransition } from './transitions';

let routerHandle: AllAboardRouterHandle | null = null;
let disposeDirections: (() => void) | null = null;
let disposeRefreshAction: (() => void) | null = null;
let disposeColorScheme: (() => void) | null = null;
let disposeTrainSelectionTransition: (() => void) | null = null;

type BackendStatus = 'connecting' | 'connected' | 'offline';
let hostBindingsMounted = false;
let pendingBackendStatus: BackendStatus = 'connecting';

function projectBackendStatus(status: BackendStatus): void {
  // @ref LLP 0052#d1--reactive-host-state-host-bindings — project provider lifecycle through the declared appGlue binding, with canonical equality at publication.
  pendingBackendStatus = status;
  if (hostBindingsMounted) publishHostState('backend', { status });
}

// Startup timing (ENG-23727 / ENG-24386 acceptance): all values are ms since
// timeOrigin (performance.now() epoch) so the acceptance suite can compare
// them. `htmlReceivedMs` is the budget origin because static dependencies
// evaluate before this module body can record `scriptStartMs`; the latter is a
// secondary diagnostic only. Board paint must never wait on backend milestones.
const timing: {
  htmlReceivedMs: number | null;
  scriptStartMs: number;
  usefulBoardCommittedMs: number | null;
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
  usefulBoardCommittedMs: null,
  firstBoardPaintMs: null,
  backendConnectedMs: null,
  liveDataAppliedMs: null,
};
let resolveFirstBoardPaint!: () => void;
const firstBoardPaintReady = new Promise<void>((resolvePaint) => {
  resolveFirstBoardPaint = resolvePaint;
});
let firstBoardPaintResolved = false;
let usefulBoardCommitObserved = false;

function markFirstBoardPaint(at: number): void {
  if (firstBoardPaintResolved) return;
  firstBoardPaintResolved = true;
  timing.firstBoardPaintMs = at;
  logTiming('first board paint', at);
  resolveFirstBoardPaint();
}

function markUsefulBoardCommitted(): void {
  if (usefulBoardCommitObserved) return;
  usefulBoardCommitObserved = true;
  timing.usefulBoardCommittedMs = typeof performance !== 'undefined' ? performance.now() : 0;
  logTiming('useful board committed', timing.usefulBoardCommittedMs);

  const markAfterPaint = () => {
    markFirstBoardPaint(typeof performance !== 'undefined' ? performance.now() : 0);
  };
  if (typeof requestAnimationFrame === 'function') {
    // rAF callbacks run before their frame's paint. The second callback has a
    // complete rendering opportunity between it and this committed board, so
    // releasing backend work here preserves commit -> paint -> connect.
    requestAnimationFrame(() => requestAnimationFrame(markAfterPaint));
  } else {
    markAfterPaint();
  }
}

const logTiming = (label: string, at: number | null) => {
  console.log(`[all-aboard] ${label} at ${at === null ? '?' : Math.round(at)}ms`);
};

// Build-time API origin injected by vite.config.ts `define`.
declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  const origin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return snapbackWebBaseUrl(__SNAPBACK_API_ORIGIN__, origin);
}

// The Exact dev server serves its own generated HTML shell (index.html is not
// consulted), so the web-host page chrome lives here: the viewport height
// chain the full-bleed stack needs, the dark backdrop, and text-selection
// scoping. Pager touch-action is framework-owned (Exact LLP 0336 P1). This is
// surface chrome beside the independently declared host bindings and
// boot-status projection.
function installWebChrome(): void {
  if (typeof document === 'undefined' || document.getElementById('all-aboard-web-css')) return;
  document.title = 'All Aboard — Caltrain';
  const style = document.createElement('style');
  style.id = 'all-aboard-web-css';
  style.textContent = `
    html, body, #exact-root { height: 100%; margin: 0; }
    body { background: #ffffff; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { body:not([data-aa-scheme]) { background: #14171C; } }
    body[data-aa-scheme="dark"] { background: #14171C; }
    body[data-aa-scheme="light"] { background: #ffffff; }
    #exact-root { -webkit-user-select: none; user-select: none; }
    #exact-root input, #exact-root textarea { -webkit-user-select: text; user-select: text; }
    [data-testid="settings-location"] { cursor: pointer; }
    /* The directions affordance long-presses into the sheet (ENG-23795):
       keep the browser's own touch callout/selection off it. */
    [data-testid^="station-directions-"] { cursor: pointer; -webkit-touch-callout: none; }
    /* Tap-to-select morph (transitions.ts): quick, not showy. */
    ::view-transition-group(*) { animation-duration: 170ms; }
    ::view-transition-old(root), ::view-transition-new(root) { animation-duration: 170ms; }
    input::placeholder { color: rgba(26, 31, 39, 0.4); }
    body[data-aa-scheme="dark"] input::placeholder { color: rgba(242, 244, 247, 0.4); }
    #boot-status { display: none; position: fixed; left: 16px; bottom: 16px; z-index: 99; max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px; border: 1px solid #b4525f; border-radius: 10px; background: #0d1322;
      color: #ffb3bd; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
    #boot-status[data-state="error"] { display: block; }
  `;
  document.head.appendChild(style);
}

// Dark mode follows the declared Contract host channel. Exact owns the one
// physical matchMedia subscription; the page backdrop follows the same OS
// query in CSS, which does not create a second JS host-state driver. The URL
// and acceptance override is installed on Exact's documented host bridge
// before the Contract root mounts, then published explicitly when changed.
type ExactColorSchemeBridge = { colorScheme?: 'light' | 'dark' } & Record<string, unknown>;

function setColorSchemeBridge(scheme: 'light' | 'dark'): void {
  const globals = globalThis as { exact?: ExactColorSchemeBridge };
  const bridge = globals.exact && typeof globals.exact === 'object' ? globals.exact : {};
  bridge.colorScheme = scheme;
  globals.exact = bridge;
}

function colorSchemeOverrideFromUrl(): 'light' | 'dark' | null {
  try {
    const value = new URL(window.location.href).searchParams.get('appearance');
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function prepareColorSchemeOverride(): void {
  const override = colorSchemeOverrideFromUrl();
  if (!override) return;
  setColorSchemeBridge(override);
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.aaScheme = override;
  }
}

// window.__aaSetColorScheme is an acceptance/debug entry point because page
// JavaScript cannot synthesize a real OS media-query change.
function installColorSchemeControl(): () => void {
  const globals = globalThis as { __aaSetColorScheme?: (scheme: string) => void };
  const apply = (value: string) => {
    const scheme = value === 'dark' ? 'dark' : 'light';
    setColorSchemeBridge(scheme);
    publishHostTransaction({ colorScheme: scheme });
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.aaScheme = scheme;
    }
  };
  globals.__aaSetColorScheme = apply;
  return () => {
    if (globals.__aaSetColorScheme === apply) delete globals.__aaSetColorScheme;
  };
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
  prepareColorSchemeOverride();
  installContractWebHost();
  routerHandle = await mountAllAboardRouter();
  // mountContractRouterAdapter resolves only after the initial Contract tree
  // is mounted into the web host. Treat that as the useful-board commit
  // witness, then cross a real paint opportunity before releasing connect.
  markUsefulBoardCommitted();
  hostBindingsMounted = true;
  projectBackendStatus(pendingBackendStatus);

  const rootEl = typeof document !== 'undefined' ? document.getElementById('exact-root') : null;
  if (rootEl) {
    disposeDirections = installDirections(rootEl);
    disposeRefreshAction = installRefreshAction(rootEl, client);
    disposeColorScheme = installColorSchemeControl();
    disposeTrainSelectionTransition = installTrainSelectionTransition(rootEl);
  }
  // `ready` cannot report a backend connection ahead of the useful board
  // paint merely because a loopback backend resolves in the same turn.
  await firstBoardPaintReady;
}

const client = new SnapbackClient(snapbackBaseUrl(), snapbackTargetClientOptions());
setRouteEstimateTransport(async (args) => {
  const run = await client.action('routeEstimate', { args });
  if (!run?.ok) {
    const message = run?.diagnostic?.message ?? 'routeEstimate action failed';
    throw new Error(message);
  }
  return run.result ?? {};
});

// Backend attach, behind the board (ENG-23736): the adapter's render-first
// mode returns links synchronously (queries hold 'pending', mutations queue)
// and runs the backend phase behind them — the D4-shaped health + single
// idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527: the server
// inspects, provisions only what is missing, seeds only when the schedule
// tables are empty) via the `connect` hook, then the generated Contract
// surface with live push (LLP 0034 D1). Transient failures (server down,
// network) retry on capped backoff while the board keeps showing scheduled
// departures under an honest note. The adapter keys that decision on client
// transport provenance across both connect and live subscription setup;
// answered HTTP failures and other terminal defects fail loudly.
let provisioned: string[] = [];
const renderFirst = createRenderFirstSnapbackContractSurface({
  runtime: contractRuntime,
  client,
  manifest: contractDataManifest,
  artifactIndex,
  schemaManifest,
  functionManifest: functionsManifest,
  liveQueries: ['liveTrainStatus', 'liveDepartures', 'feedState'],
  requiredQueries: ['liveTrainStatus', 'liveDepartures', 'feedState'],
  connect: async () => {
    // Render-first means backend work itself starts after the useful board
    // paint—not merely that `ready` records its timestamp later.
    await firstBoardPaintReady;
    await client.health();
    const ensured = await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    provisioned = [
      ensured.schema === 'provisioned' ? 'schema' : null,
      ensured.functions === 'provisioned' ? 'functions' : null,
      ensured.seed === 'seeded' ? 'seed' : null,
    ].filter((action): action is string => action !== null);
  },
  onRetry: (error, { attempt, delayMs }) => {
    projectBackendStatus('offline');
    console.warn(`[all-aboard] backend connect failed (attempt ${attempt + 1}); retrying in ${delayMs}ms`, error);
  },
});
configureSnapbackContractLinks(renderFirst.links as never);
renderFirst.onFirstDelivery(() => {
  timing.liveDataAppliedMs = performance.now();
  logTiming('live data applied', timing.liveDataAppliedMs);
});

const ready = (async () => {
  await mountBoard(client);
  const surface = await renderFirst.attached;
  projectBackendStatus('connected');
  timing.backendConnectedMs = performance.now();
  logTiming('backend connected', timing.backendConnectedMs);
  return { provisioned, surface };
})().catch((error) => {
  projectBackendStatus('offline');
  const message = error instanceof Error ? error.message : String(error);
  showBootError(`Boot failed: ${message}`);
  console.error(error);
  throw error;
});

// Test/debug facts: the browser acceptance suite asserts the paved path
// through these (livePush, per-query connection values, the provisioning
// actions this window actually performed) plus the ENG-23727 startup timing.
(globalThis as { allAboard?: unknown }).allAboard = {
  ready,
  startupTiming: timing,
};
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
    hostBindingsMounted = false;
    routerHandle?.dispose();
    if (disposeDirections) disposeDirections();
    if (disposeColorScheme) disposeColorScheme();
    if (disposeTrainSelectionTransition) disposeTrainSelectionTransition();
    disposeRefreshAction = null;
    routerHandle = null;
    disposeDirections = null;
    disposeColorScheme = null;
    disposeTrainSelectionTransition = null;
    setRouteEstimateTransport(null);
    renderFirst.dispose();
    resetSnapbackContractLinks();
    reset();
  });
}
