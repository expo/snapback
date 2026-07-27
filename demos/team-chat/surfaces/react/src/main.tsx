import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import { App, PERSONAS } from './App';
import { teamChatClient } from './provider';
import './styles.css';

function initialUserId(): string {
  const requested = new URLSearchParams(location.search).get('user');
  return PERSONAS.find(({ id, userId }) => id === requested || userId === requested)?.userId
    ?? PERSONAS[0].userId;
}

async function boot() {
  await teamChatClient.health();
  await teamChatClient.ensureApp({
    schema: schemaManifest,
    functions: functionsManifest,
  });
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <App initialUserId={initialUserId()} />
    </StrictMode>,
  );
  return teamChatClient;
}

const ready = boot().catch((error) => {
  console.error('[team-chat react] boot failed', error);
  const root = document.getElementById('root');
  if (root) root.textContent = 'Team Chat could not reach the Snapback server.';
  throw error;
});

(globalThis as { teamChatReady?: unknown }).teamChatReady = ready;
