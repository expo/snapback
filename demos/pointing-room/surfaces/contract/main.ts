import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
  createSnapbackContractSurface,
} from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';
import app from './pointing.contract';

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

const INITIAL_ROOM_ID = 'room_planning';
let activeSurfaces: Array<{ dispose?: () => unknown }> = [];

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const node = document.getElementById('boot-status');
  if (!node) return;
  node.textContent = message;
  node.dataset.state = state;
}

function apiOrigin(): string {
  return typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0
    ? __SNAPBACK_API_ORIGIN__
    : '/snapback';
}

function persona(): { email: string; name: string } {
  const params = new URLSearchParams(location.search);
  const email = params.get('email') ?? 'ada@pointing-room.local';
  const name = params.get('name') ?? email.split('@')[0] ?? 'planner';
  return { email, name };
}

async function signIn(client: SnapbackClient, email: string) {
  const challenge = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `/__pointing-mailbox?challengeId=${encodeURIComponent(challenge.challengeId)}`,
  );
  if (!mailboxResponse.ok) {
    throw new Error(`local sign-in mailbox refused (${mailboxResponse.status}): ${await mailboxResponse.text()}`);
  }
  const mailbox = await mailboxResponse.json() as { code: string };
  return await client.authExchange({ challengeId: challenge.challengeId, code: mailbox.code });
}

async function boot() {
  const identity = persona();
  status(`Signing in ${identity.name}…`);
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(apiOrigin(), {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: `pointing-room-${identity.email.replace(/[^a-z0-9]/gi, '-')}`,
  });
  await client.health();
  const credential = await signIn(client, identity.email);

  status('Opening live Contract bindings…');
  const runtime = await import('@exact/contract/runtime');
  const surface = await createSnapbackContractSurface({
    runtime,
    client,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    liveQueries: ['liveRound', 'liveTally'],
    requiredQueries: ['liveRound', 'liveTally', 'roomPresence'],
    keyedQueryScopes: true,
    liveFallbackToPoll: false,
    ephemeralIdleLingerMs: 0,
  });
  activeSurfaces = [surface];
  await surface.prewarmEphemeral('roomPresence', { roomId: INITIAL_ROOM_ID });
  configureSnapbackContractLinks(surface.links as never);

  installContractWebHost();
  mount(app, {
    props: {
      viewerId: credential.session.userId,
      viewerName: identity.name,
      initialRoomId: INITIAL_ROOM_ID,
    },
  });
  status('Ready', 'ready');
  const facts = {
    surface,
    userId: credential.session.userId,
    initialRoomId: INITIAL_ROOM_ID,
    email: identity.email,
  };
  (globalThis as { pointingRoom?: unknown }).pointingRoom = facts;
  return facts;
}

const ready = boot().catch((error) => {
  console.error('[pointing-room contract] boot failed', error);
  status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
  throw error;
});
(globalThis as { pointingRoomReady?: unknown }).pointingRoomReady = ready;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const surface of activeSurfaces) void surface.dispose?.();
    activeSurfaces = [];
    resetSnapbackContractLinks();
    reset();
  });
}
