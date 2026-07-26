import {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  createProviderQueryHandle,
  mount,
  readContractSizeClass,
  reset,
  type ContractDataProvider,
  type ContractHydrationManifest,
  type MountHandle,
} from '@exact/contract/runtime';
import { setThemeReducedMotion, setThemeViewportWidth } from '@exact/facet-core';
import { installContractWebHost, type ContractWebHostHandle } from '@exact/renderer/web-host';

import seed from '../../snapback/seed.json';
import feedApp from './feed.contract';
import eventApp from './event.contract';
import {
  configureGeneratedProviderLinks,
  resetGeneratedProviderLinks,
  type GeneratedProviderLinks,
} from './data/provider.generated';
import { GatewayContractProvider } from './provider';
import {
  createHydrationSeededProvider,
  linksForProvider,
  type HydrationProviderEvidence,
} from './production-hydration';
import { readPartitimeHydrationManifest } from './hydration-manifest-reader';
import { PERSONAS, type BackendMode } from '../../shared/model';

declare const __MATRIX_BACKEND__: BackendMode;
declare const __PARTITIME_BASE_PATH__: string;
declare const __SNAPBACK_API_ORIGIN__: string;
declare const __MATRIX_GATEWAY_ORIGIN__: string;
declare const __PARTITIME_DISABLE_POLL_FALLBACK__: boolean;
declare const __CONVEX_URL__: string;

let active: {
  dispose?: () => void | Promise<void>;
  transportEvidence?: () => readonly Record<string, unknown>[];
  provider?: ContractDataProvider;
  hydrationEvidence?: () => HydrationProviderEvidence | null;
} | null = null;
let routeTransition: Promise<unknown> = Promise.resolve();
const subscriptionEvents: Record<string, unknown>[] = [];
let forcedQueryState: { dispose(): void } | null = null;
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const syncViewport = () => setThemeViewportWidth(innerWidth);
const syncReducedMotion = () => setThemeReducedMotion(reducedMotionQuery.matches);
addEventListener('resize', syncViewport);
reducedMotionQuery.addEventListener('change', syncReducedMotion);

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — adoption
// needs the released-v1 identity sink, not the producer transcript. Keeping
// this inert sink at the app boundary preserves the published Exact 0.1.5
// consumer lane without retaining the producer-only capture implementation.
const hydrationAdoptionCapture = Object.freeze({
  recordHostState() {},
  recordNode() {},
  recordComponentState() {},
  recordHandler() {},
  noteDeferredMountTasks() {},
  noteMountTasksReleasedBeforeAdoption() {},
});

function clearForcedQueryState(): void {
  forcedQueryState?.dispose();
  forcedQueryState = null;
}

const debug = {
  forceFeedState(state: 'loading' | 'error' | 'empty' | 'ready') {
    clearForcedQueryState();
    const force = active?.provider?.forceQueryState;
    if (!force) throw new Error('Contract provider lacks forceQueryState().');
    const cell = state === 'loading'
      ? { status: 'pending', connection: 'connecting' }
      : state === 'error'
        ? { status: 'error', error: { message: 'Forced Partitime failure' }, connection: 'disconnected' }
        : state === 'empty'
          ? { status: 'ready', value: [], empty: true, connection: 'live' }
          : { status: 'ready', value: seed.tables.events, empty: false, connection: 'live' };
    forcedQueryState = force.call(active?.provider, 'listEvents', cell);
    return state;
  },
  restoreFeedState() {
    clearForcedQueryState();
  },
};

(globalThis as { partifulMatrixDebug?: typeof debug }).partifulMatrixDebug = debug;

function status(message: string, state: 'booting'|'ready'|'error' = 'booting') {
  const el = document.getElementById('boot-status');
  if (!el || (el.dataset.state === 'ready' && state !== 'error')) return;
  // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — once
  // mounted UI owns progress, route remounts must not churn the hidden boot
  // sentinel. A later failure may still surface it.
  if (el.textContent === message && el.dataset.state === state) return;
  el.textContent = message;
  el.dataset.state = state;
}

function normalizedBasePath(): string {
  const rooted = __PARTITIME_BASE_PATH__.startsWith('/') ? __PARTITIME_BASE_PATH__ : `/${__PARTITIME_BASE_PATH__}`;
  return rooted.endsWith('/') ? rooted : `${rooted}/`;
}

function eventIdFromLocation(params: URLSearchParams): string | null {
  const base = normalizedBasePath();
  const relative = location.pathname.startsWith(base)
    ? location.pathname.slice(base.length)
    : location.pathname.replace(/^\//, '');
  const match = relative.match(/^events\/([^/]+)\/?$/);
  if (match?.[1] === 'new') return null;
  return match ? decodeURIComponent(match[1]!) : params.get('event');
}

function isCreateRoute(): boolean {
  const base = normalizedBasePath();
  const relative = location.pathname.startsWith(base)
    ? location.pathname.slice(base.length)
    : location.pathname.replace(/^\//, '');
  return /^events\/new\/?$/.test(relative);
}

function routeIdFor(eventId: string | null, createRoute: boolean): string {
  return createRoute ? '/events/new/' : eventId === null ? '/' : `/events/${encodeURIComponent(eventId)}/`;
}

function updateDocumentMetadata(eventId: string | null, createRoute: boolean): void {
  const event = eventId === null ? null : seed.tables.events.find((row) => row._id === eventId) ?? null;
  document.title = createRoute ? 'Create an event · Partitime' : event ? `${event.title} · Partitime` : 'Partitime · plans worth leaving the chat for';
  const description = createRoute ? 'Create a Partitime event.' : event?.description ?? 'Small gatherings, good people, and plans worth leaving the chat for.';
  let descriptionNode = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!descriptionNode) {
    descriptionNode = document.createElement('meta');
    descriptionNode.name = 'description';
    document.head.appendChild(descriptionNode);
  }
  descriptionNode.content = description;
  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  canonical.href = new URL(`${normalizedBasePath()}${createRoute ? 'events/new/' : eventId === null ? '' : `events/${encodeURIComponent(eventId)}/`}`, location.origin).href;
}

function staticHydrationManifest(expectedRouteId: string, canonicalProps: boolean): ContractHydrationManifest | null {
  if (!canonicalProps) return null;
  const root = document.getElementById('exact-root');
  const script = document.getElementById('__partitime-hydration');
  if (!root || root.dataset.partitimeStaticRoute !== expectedRouteId || !(script instanceof HTMLScriptElement)) return null;
  try {
    const manifest = readPartitimeHydrationManifest(JSON.parse(script.textContent ?? 'null'));
    if (!manifest || manifest.routeId !== expectedRouteId) return null;
    // The parsed manifest owns the adoption turn from here. Leaving the
    // serialized copy in the live DOM retains the same node/path ledger twice.
    script.remove();
    return manifest;
  } catch {
    return null;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('user');
  const persona = PERSONAS.find((item) => item.id === requested || item.userId === requested) ?? PERSONAS[0];
  const createRoute = isCreateRoute();
  const eventId = eventIdFromLocation(params);
  const routeId = routeIdFor(eventId, createRoute);
  const visualVariant = params.get('theme') === 'night' ? 'night' : 'warm';
  const hydrationManifest = staticHydrationManifest(
    routeId,
    persona.userId === PERSONAS[0]!.userId && visualVariant === 'warm',
  );
  status(`Connecting Contract to ${__MATRIX_BACKEND__}…`);
  updateDocumentMetadata(eventId, createRoute);

  let surface: {
    links: GeneratedProviderLinks;
    provider: ContractDataProvider;
    dispose?: () => void | Promise<void>;
    transportEvidence?: () => readonly Record<string, unknown>[];
  };

  if (__MATRIX_BACKEND__ === 'snapback') {
    // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — gateway
    // cells must not retain the Snapback client, Contract adapter, or generated
    // manifests merely because the comparison entry point can select them.
    const [
      { SnapbackClient },
      { createOnlineSnapbackContractSurface },
      { default: artifactIndex },
      { default: contractDataManifest },
      { default: functionsManifest },
      { default: schemaManifest },
    ] = await Promise.all([
      import('../../../../packages/snapback-client/online.mjs'),
      import('../../../../packages/snapback-contract/online-surface.mjs'),
      import('../../snapback/generated/artifacts.json'),
      import('../../snapback/generated/contract-data.manifest.json'),
      import('../../snapback/generated/functions.manifest.json'),
      import('../../snapback/generated/schema.manifest.json'),
    ]);
    const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
    await client.health();
    // @ref LLP 0034#5 — one idempotent ensure per mount; never reset from a
    // Contract surface, so reload and cross-arm mutations remain observable.
    await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    const liveQueries = eventId === null
      ? ['listEvents']
      : [
          { name: 'eventDetails', args: { eventId } },
          { name: 'guestList', args: { eventId } },
          { name: 'eventWall', args: { eventId } },
        ];
    const created = await createOnlineSnapbackContractSurface({
      runtime: {
        createBoundaryContractDataProvider,
        createContractMockQueryBoundary,
        createProviderQueryHandle,
      },
      client,
      userId: persona.userId,
      manifest: contractDataManifest, artifactIndex, schemaManifest, functionManifest: functionsManifest,
      liveQueries,
      requiredQueries: liveQueries,
      liveFallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
      onConnectionChange: (connection: string, detail: Record<string, unknown>) => subscriptionEvents.push({
        kind: 'connection',
        connection,
        ...detail,
      }),
      onSubscriptionEvent: (event: Record<string, unknown>) => subscriptionEvents.push({
        pollFallbackEnabled: !__PARTITIME_DISABLE_POLL_FALLBACK__,
        ...event,
      }),
    });
    surface = created as typeof surface;
  } else if (__MATRIX_BACKEND__ === 'convex-realtime') {
    const { ConvexContractProvider } = await import('./convex-provider');
    const provider = new ConvexContractProvider(__CONVEX_URL__, persona.userId);
    surface = { links: provider.links(), provider, dispose: () => provider.dispose() };
  } else {
    const provider = new GatewayContractProvider(__MATRIX_BACKEND__, __MATRIX_GATEWAY_ORIGIN__ || '/matrix-api', persona.userId);
    surface = { links: linksForProvider(provider), provider, dispose: () => provider.dispose() };
  }

  let hydrationProvider: ReturnType<typeof createHydrationSeededProvider> | null = null;
  if (hydrationManifest) {
    hydrationProvider = createHydrationSeededProvider(surface.provider);
    configureGeneratedProviderLinks(linksForProvider(hydrationProvider.provider));
  } else {
    configureGeneratedProviderLinks(surface.links);
  }

  const root = document.getElementById('exact-root') ?? document.body;
  let host: ContractWebHostHandle | null = null;
  let mounted: MountHandle | null = null;
  let hydrationResult: Record<string, unknown> | null = null;
  let adoptedText: string | null = null;
  let preMountSizeClass: string | null = null;
  // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
  // feed's one-subscription memory instrument must not retain the unopened
  // event route's generated IR and AOT closures.
  const component = eventId === null
    ? feedApp
    : (await import('./event.contract')).default;
  const props = eventId === null
    ? {
        userName: persona.name,
        backendName: __MATRIX_BACKEND__,
        initialVariant: visualVariant,
        initialCreating: createRoute,
        initialUiState: params.get('uiState') ?? 'ready',
      }
    : {
        eventId,
        userId: persona.userId,
        userName: persona.name,
        backendName: __MATRIX_BACKEND__,
        visualVariant,
        initialUiState: params.get('uiState') ?? 'ready',
      };
  if (hydrationManifest) {
    let resolveHydrationReported!: () => void;
    const hydrationReported = new Promise<void>((resolve) => {
      resolveHydrationReported = resolve;
    });
    host = installContractWebHost({
      container: root,
      hydrate: {
        rootId: hydrationManifest.rootId,
        manifest: hydrationManifest,
        onResult(result) {
          // @ref LLP 0063#workstream-7--complete-the-application-platform —
          // production adoption evidence ends before live browser turns.
          // The Exact runtime retains its result object while later responsive
          // and live updates run. Freeze the completed adoption turn here so
          // normal post-adoption updates cannot rewrite the production proof.
          const adoptionSnapshot = structuredClone(result);
          hydrationResult = adoptionSnapshot;
          (globalThis as { __exactContractHydrationResult?: unknown }).__exactContractHydrationResult = {
            ...adoptionSnapshot,
            mountPath: 'partitime-static-document',
          };
          resolveHydrationReported();
        },
      },
    });
    // The web host publishes the live viewport when installed. Replay the
    // captured server inputs after installation and before the first mount;
    // release back to live browser inputs only after adoption completes.
    setThemeViewportWidth(hydrationManifest.capabilities.viewport?.width ?? innerWidth);
    setThemeReducedMotion(hydrationManifest.capabilities.reducedMotion ?? false);
    preMountSizeClass = readContractSizeClass();
    mounted = mount(component, {
      rootId: hydrationManifest.rootId,
      props,
      hydration: {
        capabilities: hydrationManifest.capabilities,
        capture: hydrationAdoptionCapture,
        deferMountTasks: true,
      },
    });
    // Seeded query delivery can settle after mount returns. Keep captured
    // capability inputs authoritative until the web host confirms that its
    // first complete DOM adoption commit has been reported.
    await hydrationReported;
    mounted.releaseHydrationTasks?.();
    adoptedText = root.innerText;
    hydrationProvider.release();
    syncViewport();
    syncReducedMotion();
  } else {
    syncViewport();
    syncReducedMotion();
    root.replaceChildren();
    host = installContractWebHost({ container: root });
    mounted = mount(component, { props });
  }

  // Preserve the mounted provider as the evidence source even after disposeActive
  // clears the global slot. The provider records its close event during disposal,
  // and the acceptance harness reads that retained evidence afterward.
  const evidenceSource = surface;
  active = {
    provider: surface.provider,
    transportEvidence: surface.transportEvidence,
    hydrationEvidence: () => hydrationProvider?.evidence() ?? null,
    async dispose() {
      mounted?.dispose();
      mounted = null;
      host?.dispose();
      host = null;
      await surface.dispose?.();
    },
  };

  status('Ready', 'ready');
  return {
    backend: __MATRIX_BACKEND__,
    authoring: 'contract',
    transport: __MATRIX_BACKEND__ === 'snapback' || __MATRIX_BACKEND__ === 'convex-realtime' ? 'push' : 'poll',
    screen: createRoute ? 'create' : eventId ? 'event' : 'feed',
    eventId,
    routeId,
    hydration: hydrationManifest ? {
      manifest: {
        rootId: hydrationManifest.rootId,
        routeId: hydrationManifest.routeId,
        serverVerification: hydrationManifest.verification,
      },
      result: hydrationResult,
      provider: hydrationProvider?.evidence() ?? null,
      adoptedText,
      preMountSizeClass,
    } : null,
    transportEvidence: () => evidenceSource?.transportEvidence?.().map((event) => ({ ...event }))
      ?? subscriptionEvents.map((event) => ({ ...event })),
    dispose: disposeActive,
  };
}

async function disposeActive() {
  clearForcedQueryState();
  const current = active;
  active = null;
  await current?.dispose?.();
  resetGeneratedProviderLinks();
  reset();
}

function mountCurrentRoute(focusTestId?: string) {
  routeTransition = routeTransition.then(async () => {
    await disposeActive();
    return boot();
  });
  const ready = routeTransition.then(async (result) => {
    if (focusTestId) {
      // @ref LLP 0063#workstream-3--contract-as-a-complete-product-surface-language —
      // route remounts replace the overlay opener, so restore to the new
      // semantic target only after the replacement tree has committed.
      // Safari may suspend animation-frame callbacks while the route teardown
      // removes the focused overlay. A zero-delay task runs after the
      // replacement tree commits without depending on a paint callback.
      await new Promise<void>((resolveFocus) => setTimeout(() => {
        document.querySelector<HTMLElement>(`[data-testid="${CSS.escape(focusTestId)}"]`)?.focus();
        resolveFocus();
      }, 0));
    }
    return result;
  }).catch((error) => {
    console.error('[partiful-matrix/contract] boot failed', error);
    status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw error;
  });
  (globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;
  return ready;
}

const onRouteChange = (event: Event) => {
  const focusTestId = event instanceof CustomEvent && typeof event.detail?.focusTestId === 'string'
    ? event.detail.focusTestId
    : undefined;
  mountCurrentRoute(focusTestId);
};
addEventListener('popstate', onRouteChange);
addEventListener('partitime:navigate', onRouteChange);
const ready = mountCurrentRoute();

if (import.meta.hot) import.meta.hot.dispose(() => {
  removeEventListener('popstate', onRouteChange);
  removeEventListener('partitime:navigate', onRouteChange);
  removeEventListener('resize', syncViewport);
  reducedMotionQuery.removeEventListener('change', syncReducedMotion);
  void disposeActive();
});
