import {
  createBoundaryContractDataProvider,
  createContractMockQueryBoundary,
  createProviderQueryHandle,
  createOnlineSnapbackContractSurface,
  installContractWebHost,
  mount,
  reset,
  SnapbackClient,
  type ContractWebHostHandle,
  type MountHandle,
} from './published-runtime.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import listApp from './list.contract';
import roomApp from './room.contract';
import './styles.css';

declare const __SNAPBACK_API_ORIGIN__: string;

const PERSONAS = [
  { id: 'owner', userId: 'user_owner', name: 'Owner' },
  { id: 'member', userId: 'user_member_01', name: 'Member 01' },
  { id: 'outsider', userId: 'user_unrelated', name: 'Outsider' },
] as const;

type OnlineSurface = Awaited<ReturnType<typeof createOnlineSnapbackContractSurface>>;
type Active = {
  host: ContractWebHostHandle | null;
  mounted: MountHandle;
  surface: OnlineSurface;
};

let active: Active | null = null;
let routeTransition: Promise<unknown> = Promise.resolve();

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const node = document.getElementById('boot-status');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}

function routeRoomId(): string | null {
  const match = location.pathname.match(/^\/rooms\/([^/]+)\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function personaFromLocation() {
  const requested = new URLSearchParams(location.search).get('user');
  return PERSONAS.find(({ id, userId }) => id === requested || userId === requested)
    ?? PERSONAS[0];
}

async function disposeActive(): Promise<void> {
  const current = active;
  active = null;
  current?.mounted.dispose();
  current?.host?.dispose();
  await current?.surface.dispose?.();
  resetSnapbackContractLinks();
  reset();
}

async function boot() {
  const persona = personaFromLocation();
  const roomId = routeRoomId();
  const queryScopes = roomId === null
    ? ['listMyRooms', 'unreadDeliveries']
    : [
        { name: 'roomDetails', args: { roomId } },
        { name: 'roomMessages', args: { roomId } },
        'unreadDeliveries',
      ];

  status('Connecting Contract to Snapback…');
  const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
  await client.health();
  // @ref LLP 0034#5 — page boot is inspect-first and idempotent. Navigation
  // remounts Contract but never resets or reseeds the shared backend.
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest });

  status('Opening live Contract bindings…');
  const surface = await createOnlineSnapbackContractSurface({
    runtime: {
      createBoundaryContractDataProvider,
      createContractMockQueryBoundary,
      createProviderQueryHandle,
    },
    client,
    userId: persona.userId,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    liveQueries: queryScopes,
    requiredQueries: queryScopes,
    liveFallbackToPoll: false,
  });
  configureSnapbackContractLinks(surface.links as never);

  const root = document.getElementById('exact-root') ?? document.body;
  root.replaceChildren();
  const host = installContractWebHost({ container: root });
  const mounted = roomId === null
    ? mount(listApp, {
        props: {
          userId: persona.userId,
          displayName: persona.name,
        },
      })
    : mount(roomApp, {
        props: {
          roomId,
          userId: persona.userId,
          displayName: persona.name,
          inviteeId: PERSONAS[1].userId,
          inviteeName: PERSONAS[1].name,
        },
      });
  active = { host, mounted, surface };
  document.title = roomId === null ? 'Team Chat · Contract' : 'Protected room · Team Chat';
  status('Ready', 'ready');
  return {
    persona: persona.id,
    screen: roomId === null ? 'rooms' : 'room',
    roomId,
    claimEligible: false,
    dispose: disposeActive,
  };
}

function mountCurrentRoute() {
  routeTransition = routeTransition.then(async () => {
    await disposeActive();
    return boot();
  });
  const ready = routeTransition.catch((error) => {
    console.error('[team-chat/contract] boot failed', error);
    status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    throw error;
  });
  (globalThis as { teamChatContractReady?: unknown }).teamChatContractReady = ready;
  return ready;
}

const onRouteChange = () => {
  mountCurrentRoute();
};
addEventListener('popstate', onRouteChange);
addEventListener('team-chat-contract:navigate', onRouteChange);
mountCurrentRoute();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeEventListener('popstate', onRouteChange);
    removeEventListener('team-chat-contract:navigate', onRouteChange);
    void disposeActive();
  });
}
