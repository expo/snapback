import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '../../../../../packages/snapback-react/index.mjs';

import capabilityManifest from '../../../snapback/generated/capability.manifest.json';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import routesManifest from '../../../snapback/generated/routes.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import runtimeApi from '../../../snapback/generated/api.mjs';
import type { GeneratedApi } from '../../../snapback/generated/api';
import { App, PERSONAS } from './App';
import { teamChatClient } from './provider';
import './styles.css';

const api = runtimeApi as GeneratedApi;

function initialUserId(): string {
  const requested = new URLSearchParams(location.search).get('user');
  return PERSONAS.find(({ id, userId }) => id === requested || userId === requested)?.userId
    ?? PERSONAS[0].userId;
}

async function boot() {
  (globalThis as any).teamChatBootStage = 'health';
  await teamChatClient.health();
  (globalThis as any).teamChatBootStage = 'ensure';
  await teamChatClient.ensureApp({
    schema: schemaManifest,
    functions: functionsManifest,
    routes: routesManifest,
  });
  (globalThis as any).teamChatBootStage = 'prepare-binding';
  const userId = initialUserId();
  const binding = await teamChatClient.prepareReactBinding({
    generatedManifest: {
      schema: schemaManifest,
      functions: functionsManifest,
      capabilityManifest,
      routes: routesManifest,
    },
  });
  (globalThis as any).teamChatBootStage = 'prepare-group';
  const preparedGroup = await binding.prepareQueryGroup(
    api.groups['/'],
    {},
    { fallbackToLive: true, userId },
  );
  (globalThis as any).teamChatBootStage = 'create-provider';
  const provider = createSnapbackReactProvider(binding, { preparedGroup });
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <SnapbackProvider provider={provider}>
        <App initialUserId={userId} />
      </SnapbackProvider>
    </StrictMode>,
  );
  (globalThis as any).teamChatBootStage = 'rendered';
  let seatHandle: any = null;
  (globalThis as { teamChatProductReceipt?: unknown }).teamChatProductReceipt = {
    async query(name: string, args: Record<string, unknown>, userId: string) {
      return await teamChatClient.query((api as any)[name], { args, userId });
    },
    async mutate(name: string, args: Record<string, unknown>, userId: string) {
      return await teamChatClient.mutate((api as any)[name], { args, userId });
    },
    async startSeats(userId: string) {
      seatHandle?.dispose();
      seatHandle = await teamChatClient.liveQuery('_snapback.myMemberships', {
        args: { membership: 'roomMembers' },
        userId,
        transport: 'stream',
        fallbackToPoll: false,
        connectionId: `team_chat_react_receipt_seats_${userId}`,
        onUpdate() {},
        onConnectionChange() {},
      });
      return seatHandle.rows;
    },
    async pollSeats() {
      return seatHandle ? await seatHandle.poll() : [];
    },
    stopSeats() {
      seatHandle?.dispose();
      seatHandle = null;
    },
  };
  return { client: teamChatClient, provider };
}

const ready = boot().catch((error) => {
  console.error('[team-chat react] boot failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = 'Team Chat could not reach the Snapback server.';
  throw error;
});

(globalThis as { teamChatReady?: unknown }).teamChatReady = ready;
