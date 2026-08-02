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
import runtimeApi from '../../snapback/generated/api.mjs';
import type { GeneratedApi } from '../../snapback/generated/api';
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
  history: { dispose(): void } | null;
  receiptSeats: Awaited<ReturnType<SnapbackClient['liveQuery']>> | null;
};

const api = runtimeApi as GeneratedApi;

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
  current?.history?.dispose();
  current?.receiptSeats?.dispose();
  await current?.surface.dispose?.();
  resetSnapbackContractLinks();
  reset();
}

function installHistoryControls(client: SnapbackClient, userId: string, roomId: string) {
  const previous = document.getElementById('contract-history');
  previous?.remove();
  const section = document.createElement('section');
  section.id = 'contract-history';
  section.dataset.testid = 'room-history';
  const label = document.createElement('strong');
  label.textContent = 'Bounded room history';
  const count = document.createElement('span');
  count.dataset.testid = 'history-count';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'history-first';
  button.textContent = 'Load first page';
  const error = document.createElement('span');
  error.dataset.testid = 'history-error';
  let rows: unknown[] = [];
  let cursor: string | null = null;
  let terminal = false;
  let disposed = false;
  const render = () => {
    count.textContent = `${rows.length} historical messages`;
    button.dataset.testid = rows.length === 0 ? 'history-first' : 'history-next';
    button.textContent = rows.length === 0 ? 'Load first page' : 'Load next page';
    button.hidden = terminal;
    let terminalNode = section.querySelector<HTMLElement>('[data-testid="history-terminal"]');
    if (terminal && !terminalNode) {
      terminalNode = document.createElement('span');
      terminalNode.dataset.testid = 'history-terminal';
      terminalNode.textContent = 'End of history';
      section.append(terminalNode);
    }
    if (!terminal) terminalNode?.remove();
  };
  button.addEventListener('click', () => {
    error.textContent = '';
    const request = cursor === null
      ? client.query(api.firstRoomMessagePage, { args: { roomId }, userId })
      : client.query(api.nextRoomMessagePage, { args: { roomId, after: cursor }, userId });
    void request.then((page) => {
      if (disposed) return;
      rows = cursor === null ? page.rows : [...rows, ...page.rows];
      cursor = page.cursor ?? null;
      terminal = cursor === null;
      render();
    }, (cause) => {
      if (disposed) return;
      rows = [];
      cursor = null;
      terminal = false;
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      render();
    });
  });
  section.append(label, count, button, error);
  document.body.append(section);
  render();

  let seats: Awaited<ReturnType<SnapbackClient['liveQuery']>> | null = null;
  void client.liveQuery('_snapback.myMemberships', {
    args: { membership: 'roomMembers' },
    userId,
    connectionId: `team_chat_contract_history_seats_${userId}`,
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(next: unknown[]) {
      if (disposed) return;
      const activeSeat = next.some((entry) => {
        const row = entry as { resource?: unknown; role?: unknown };
        return row.resource === roomId && (row.role === 'owner' || row.role === 'member');
      });
      if (!activeSeat) {
        rows = [];
        cursor = null;
        terminal = false;
        render();
      }
    },
    onConnectionChange() {},
  }).then((handle) => { seats = handle; });
  return {
    dispose() {
      disposed = true;
      seats?.dispose();
      section.remove();
    },
  };
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
  const history = roomId === null ? null : installHistoryControls(client, persona.userId, roomId);
  active = { host, mounted, surface, history, receiptSeats: null };
  document.title = roomId === null ? 'Team Chat · Contract' : 'Protected room · Team Chat';
  status('Ready', 'ready');
  return {
    persona: persona.id,
    screen: roomId === null ? 'rooms' : 'room',
    roomId,
    claimEligible: false,
    productReceipt: {
      query: (name: string, args: Record<string, unknown>, userId: string) =>
        client.query((api as any)[name], { args, userId }),
      mutate: (name: string, args: Record<string, unknown>, userId: string) =>
        client.mutate((api as any)[name], { args, userId }),
      async startSeats(userId: string) {
        active?.receiptSeats?.dispose();
        const handle = await client.liveQuery('_snapback.myMemberships', {
          args: { membership: 'roomMembers' },
          userId,
          connectionId: `team_chat_contract_receipt_seats_${userId}`,
          transport: 'stream',
          fallbackToPoll: false,
          onUpdate() {},
          onConnectionChange() {},
        });
        if (active) active.receiptSeats = handle;
        return handle.rows;
      },
      async pollSeats() {
        return active?.receiptSeats ? await active.receiptSeats.poll() : [];
      },
    },
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
