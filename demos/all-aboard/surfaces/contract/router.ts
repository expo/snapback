// All Aboard router bootstrap (Exact LLP 0336 §5 / ENG-24168).
//
// The app remains Contract-rendered end to end. The React-free Contract
// router adapter owns the route/presentation stack, browser history, and
// native host Back channel; route modules only select which AllAboard screen
// is presented. App code declares destinations, never platform bindings.

import { hostCallAsync } from '@exact/core/host-call-bridge';
import {
  createContractRouterAdapter,
  defineContractRouteModule,
  mountContractRouterAdapter,
  type ContractRouterMountHandle,
} from '@exact/router/contract';
import { attachBrowserHistory } from '@exact/router/browser';
import { createFileRouter } from '@exact/router/router';
import { attachHostUrlAdapter } from '@exact/router/url-channel';

import homeRoute from './routes/home.contract';

const routeModules = {
  'app/index.contract': defineContractRouteModule(
    async () => ({ default: homeRoute }),
    { screen: { title: 'All Aboard', shell: 'none', presentation: 'stack' } },
  ),
  'app/stations.contract': defineContractRouteModule(
    () => import('./routes/stations.contract'),
    { screen: { title: 'Stations', shell: 'none', presentation: 'modal', gestureEnabled: true } },
  ),
  'app/settings.contract': defineContractRouteModule(
    () => import('./routes/settings.contract'),
    { screen: { title: 'Settings', shell: 'none', presentation: 'modal', gestureEnabled: true } },
  ),
  'app/trip/[tripId].contract': defineContractRouteModule(
    () => import('./routes/trip.contract'),
    { screen: { title: 'Trip', shell: 'none', presentation: 'modal', gestureEnabled: true } },
  ),
};

type Router = ReturnType<typeof createFileRouter>;

interface DesktopDispatchScope {
  __exactDesktopDispatchEvent?: (
    namespace: string,
    event: string,
    payload?: unknown,
  ) => void;
}

function initialPath(): string {
  if (typeof document !== 'undefined') {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
  const configured = (globalThis as { __exactInitialPath?: unknown }).__exactInitialPath;
  return typeof configured === 'string' && configured.length > 0 ? configured : '/';
}

function platform(): string {
  if (typeof document !== 'undefined') return 'web';
  const configured = (globalThis as { __exactPlatform?: unknown }).__exactPlatform;
  return typeof configured === 'string' && configured.length > 0 ? configured : 'native';
}

function sendHistoryAck(
  router: Router,
  requestId: string | null,
  handled: boolean,
): void {
  if (!requestId) return;
  void hostCallAsync('navigation.historyAck', JSON.stringify({
    requestId,
    handled,
    canGoBack: router.canGoBack(),
    canGoForward: router.canGoForward(),
  }))?.catch(() => {});
}

function attachNativeHistory(router: Router): () => void {
  if (typeof document !== 'undefined') return () => {};
  const detachUrl = attachHostUrlAdapter(router, { announceInitial: true });
  const scope = globalThis as DesktopDispatchScope;
  const previous = scope.__exactDesktopDispatchEvent;
  const dispatch = (namespace: string, event: string, payload?: unknown): void => {
    previous?.(namespace, event, payload);
    if (namespace !== 'app' || event !== 'historyNavigation' || !payload || typeof payload !== 'object') {
      return;
    }
    const record = payload as { direction?: unknown; rootId?: unknown; requestId?: unknown };
    const rootId = typeof record.rootId === 'number' ? record.rootId : null;
    if (rootId !== null && rootId !== router.getRootId()) return;
    const direction = record.direction;
    const canMove = direction === 'back'
      ? router.canGoBack()
      : direction === 'forward'
        ? router.canGoForward()
        : false;
    const requestId = typeof record.requestId === 'string' ? record.requestId : null;
    if (!canMove) {
      sendHistoryAck(router, requestId, false);
      return;
    }
    const move = direction === 'back' ? router.back() : router.forward();
    void Promise.resolve(move)
      .then(() => sendHistoryAck(router, requestId, true))
      .catch((error: unknown) => {
        console.error('[all-aboard] host history navigation failed', error);
        sendHistoryAck(router, requestId, true);
      });
  };
  scope.__exactDesktopDispatchEvent = dispatch;
  return () => {
    detachUrl();
    if (scope.__exactDesktopDispatchEvent === dispatch) {
      scope.__exactDesktopDispatchEvent = previous;
    }
  };
}

export interface AllAboardRouterHandle {
  router: Router;
  mount: ContractRouterMountHandle;
  dispose(): void;
}

export async function mountAllAboardRouter(): Promise<AllAboardRouterHandle> {
  const router = createFileRouter({
    modules: routeModules,
    appDir: 'app',
    platform: platform(),
    initialPath: initialPath(),
    baseUrl: 'https://all-aboard.exact.local',
  });
  const detachPlatformHistory = typeof document !== 'undefined'
    ? attachBrowserHistory(router)
    : attachNativeHistory(router);
  await router.initialize();
  const adapter = createContractRouterAdapter(router);
  const mount = await mountContractRouterAdapter(adapter);
  return {
    router,
    mount,
    dispose() {
      mount.dispose();
      detachPlatformHistory();
    },
  };
}
