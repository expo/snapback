// Cursor presence — React control-arm bootstrap (ENG-22531).
//
// Boot is D4-shaped like the Contract arm's main.ts (LLP 0034 §5; the
// LLP 0025 second-window rule): health check, inspect-first ensure of the
// generated ephemeral collections, provision only when the ensure says the
// collections are unknown, never reset. Identity enters as ordinary props.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '../../../../_kit/client.mjs';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import { App, type Identity } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { CURSOR_PALETTE } from './palette';

const ROOM = 'lobby';

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  return '/snapback';
}

function randomIdentity(): Identity {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const suffix = Math.floor(Math.random() * 900 + 100);
  return {
    name: params?.get('name') ?? `guest-${suffix}`,
    color: params?.get('color') ?? CURSOR_PALETTE[suffix % CURSOR_PALETTE.length],
  };
}

async function boot() {
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();
  try {
    await client.ensureEphemeralCollections(schemaManifest);
  } catch (error) {
    const code = (error as { diagnostic?: { code?: string } })?.diagnostic?.code;
    if (code !== 'SNAPBACK_EPHEMERAL_UNKNOWN_COLLECTION') throw error;
    await client.loadSchema(schemaManifest);
    await client.ensureEphemeralCollections(schemaManifest);
  }

  const identity = randomIdentity();

  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root container');
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App client={client} roomId={ROOM} identity={identity} />
      </ErrorBoundary>
    </StrictMode>,
  );
  return { client, identity };
}

const ready = boot().catch((error) => {
  console.error('[cursors-web react] boot failed', error);
  throw error;
});
(globalThis as { cursorsWebReady?: unknown }).cursorsWebReady = ready;
