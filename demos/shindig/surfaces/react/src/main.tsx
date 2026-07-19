// Shindig — React surface bootstrap. Boot follows the React-arm guide and the
// all-aboard D4 shape: health check, then the single idempotent ensureApp of
// the generated artifacts (inspect-first provisioning; the destructive reset
// is not reachable from a browser surface). Identity is a dev-mode persona
// picked from the URL (?user=grace) or the switcher — this demo runs the
// trusted-local dev auth mode, so the persona rides each call as `userId`.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '../../../../_kit/client.mjs';
import schemaManifest from '../../../snapback/generated/schema.manifest.json';
import functionsManifest from '../../../snapback/generated/functions.manifest.json';
import { App, PERSONAS } from './App';

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  return '/snapback';
}

function initialPersonaId(): string {
  const requested = new URLSearchParams(location.search).get('user');
  const match = PERSONAS.find((p) => p.id === requested || p.userId === requested);
  return (match ?? PERSONAS[0]).userId;
}

async function boot() {
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest });

  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root container');
  createRoot(container).render(
    <StrictMode>
      <App client={client} initialUserId={initialPersonaId()} />
    </StrictMode>,
  );
  return client;
}

const ready = boot().catch((error) => {
  console.error('[shindig react] boot failed', error);
  const container = document.getElementById('root');
  if (container) {
    container.innerHTML = '<p style="padding:2rem;font-size:14px">Could not reach the Snapback server. Start one with <code>cargo run -- --port 4431 --memory</code> and reload.</p>';
  }
  throw error;
});
(globalThis as { shindigReady?: unknown }).shindigReady = ready;
