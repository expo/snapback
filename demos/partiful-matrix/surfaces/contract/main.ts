import {
  createContractHydrationCapture,
  mount,
  readContractSizeClass,
  reset,
  validateContractHydrationManifest,
  type ContractDataProvider,
  type ContractHydrationManifest,
  type MountHandle,
} from '@exact/contract/runtime';
import { setThemeReducedMotion, setThemeViewportWidth } from '@exact/facet-core';
import { installContractWebHost, type ContractWebHostHandle } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createOnlineSnapbackContractSurface } from '../../../../packages/snapback-contract/online-surface.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import feedApp from './feed.contract';
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
let routeTransition = Promise.resolve<unknown>(undefined);
const subscriptionEvents: Record<string, unknown>[] = [];
let forcedQueryState: { dispose(): void } | null = null;
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const syncViewport = () => setThemeViewportWidth(innerWidth);
const syncReducedMotion = () => setThemeReducedMotion(reducedMotionQuery.matches);
addEventListener('resize', syncViewport);
reducedMotionQuery.addEventListener('change', syncReducedMotion);

const debug = {
  forceFeedState(state: 'loading' | 'error' | 'empty' | 'ready') {
    forcedQueryState?.dispose();
    forcedQueryState = null;
    const force = active?.provider?.forceQueryState;
    if (!force) throw new Error('The active Contract provider does not expose forceQueryState().');
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
    forcedQueryState?.dispose();
    forcedQueryState = null;
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
  return match ? decodeURIComponent(match[1]!) : params.get('event');
}

function routeIdFor(eventId: string | null): string {
  return eventId === null ? '/' : `/events/${encodeURIComponent(eventId)}/`;
}

function updateDocumentMetadata(eventId: string | null): void {
  const event = eventId === null ? null : seed.tables.events.find((row) => row._id === eventId) ?? null;
  document.title = event ? `${event.title} · Partitime` : 'Partitime · plans worth leaving the chat for';
  const description = event?.description ?? 'Small gatherings, good people, and plans worth leaving the chat for.';
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
  canonical.href = new URL(`${normalizedBasePath()}${eventId === null ? '' : `events/${encodeURIComponent(eventId)}/`}`, location.origin).href;
}

function staticHydrationManifest(expectedRouteId: string, canonicalProps: boolean): ContractHydrationManifest | null {
  if (!canonicalProps) return null;
  const root = document.getElementById('exact-root');
  const script = document.getElementById('__partitime-hydration');
  if (!root || root.dataset.partitimeStaticRoute !== expectedRouteId || !(script instanceof HTMLScriptElement)) return null;
  try {
    const validation = validateContractHydrationManifest(JSON.parse(script.textContent ?? 'null'));
    if (!validation.ok || validation.manifest.routeId !== expectedRouteId) return null;
    // The parsed manifest owns the adoption turn from here. Leaving the
    // serialized copy in the live DOM retains the same node/path ledger twice.
    script.remove();
    return validation.manifest;
  } catch {
    return null;
  }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('user');
  const persona = PERSONAS.find((item) => item.id === requested || item.userId === requested) ?? PERSONAS[0];
  const eventId = eventIdFromLocation(params);
  const routeId = routeIdFor(eventId);
  const visualVariant = params.get('theme') === 'night' ? 'night' : 'warm';
  const hydrationManifest = staticHydrationManifest(
    routeId,
    persona.userId === PERSONAS[0]!.userId && visualVariant === 'warm',
  );
  status(`Connecting Contract to ${__MATRIX_BACKEND__}…`);
  updateDocumentMetadata(eventId);

  let surface: {
    links: GeneratedProviderLinks;
    provider: ContractDataProvider;
    dispose?: () => void | Promise<void>;
    transportEvidence?: () => readonly Record<string, unknown>[];
  };

  if (__MATRIX_BACKEND__ === 'snapback') {
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
      runtime: await import('@exact/contract/runtime'),
      client,
      userId: persona.userId,
      manifest: contractDataManifest, artifactIndex, schemaManifest, functionManifest: functionsManifest,
      liveQueries,
      requiredQueries: liveQueries,
      liveFallbackToPoll: !__PARTITIME_DISABLE_POLL_FALLBACK__,
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
    surface = { links: provider.links() as GeneratedProviderLinks, provider, dispose: () => provider.dispose() };
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
  if (hydrationManifest) {
    const capture = createContractHydrationCapture(hydrationManifest.capabilities);
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
    // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
    // feed's one-subscription memory instrument must not retain the unopened
    // event route's generated IR and AOT closures. Keep the startup route
    // eager and load the event carrier only when navigation selects it.
    const component = eventId === null
      ? feedApp
      : (await import('./event.contract')).default;
    const props = eventId === null
      ? { userName: persona.name, backendName: __MATRIX_BACKEND__, initialVariant: visualVariant }
      : { eventId, userId: persona.userId, userName: persona.name, backendName: __MATRIX_BACKEND__, visualVariant };
    mounted = mount(component, {
      rootId: hydrationManifest.rootId,
      props,
      hydration: { capabilities: hydrationManifest.capabilities, capture, deferMountTasks: true },
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
    mounted = eventId === null
      ? mount(feedApp, { props: { userName: persona.name, backendName: __MATRIX_BACKEND__, initialVariant: visualVariant } })
      : mount((await import('./event.contract')).default, { props: { eventId, userId: persona.userId, userName: persona.name, backendName: __MATRIX_BACKEND__, visualVariant } });
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
    screen: eventId ? 'event' : 'feed',
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
  forcedQueryState?.dispose();
  forcedQueryState = null;
  const current = active;
  active = null;
  await current?.dispose?.();
  resetGeneratedProviderLinks();
  reset();
}

function mountCurrentRoute() {
  routeTransition = routeTransition.then(async () => {
    await disposeActive();
    return boot();
  });
  const ready = routeTransition.catch((error) => {
    console.error('[partiful-matrix/contract] boot failed', error);
    status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw error;
  });
  (globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;
  return ready;
}

const onRouteChange = () => { void mountCurrentRoute(); };
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
