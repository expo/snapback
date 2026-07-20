import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import feedApp from './feed.contract';
import eventApp from './event.contract';
import { configureMatrixContractLinks, resetMatrixContractLinks, type MatrixContractLinks } from './data/runtime-links';
import { GatewayContractProvider } from './provider';
import { PERSONAS, type Backend } from '../../shared/model';

declare const __MATRIX_BACKEND__: Backend;
declare const __SNAPBACK_API_ORIGIN__: string;
declare const __MATRIX_GATEWAY_ORIGIN__: string;

let active: { dispose?: () => void } | null = null;

function status(message: string, state: 'booting'|'ready'|'error' = 'booting') {
  const el = document.getElementById('boot-status'); if (el) { el.textContent = message; el.dataset.state = state; }
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const requested = params.get('user');
  const persona = PERSONAS.find((item) => item.id === requested || item.userId === requested) ?? PERSONAS[0];
  const eventId = params.get('event');
  status(`Connecting Contract to ${__MATRIX_BACKEND__}…`);
  installContractWebHost();

  if (__MATRIX_BACKEND__ === 'snapback') {
    const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__ || '/snapback');
    await client.health();
    // @ref LLP 0034#5 — one idempotent ensure per mount; never reset from a
    // Contract surface, so reload and cross-arm mutations remain observable.
    await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
    const surface = await createSnapbackContractSurface({
      runtime: await import('@exact/contract/runtime'), client, userId: persona.userId,
      manifest: contractDataManifest, artifactIndex, schemaManifest, functionManifest: functionsManifest,
      liveQueries: eventId === null ? ['listEvents'] : [
        { name: 'eventDetails', args: { eventId } }, { name: 'guestList', args: { eventId } }, { name: 'eventWall', args: { eventId } },
      ],
    });
    active = surface;
    // The stable matrix bindings let one .contract source serve all columns;
    // this cell still delegates to the real generated Snapback surface links.
    configureMatrixContractLinks(surface.links as MatrixContractLinks);
  } else {
    const provider = new GatewayContractProvider(__MATRIX_BACKEND__, __MATRIX_GATEWAY_ORIGIN__ || '/matrix-api', persona.userId);
    active = provider;
    configureMatrixContractLinks(provider.links() as MatrixContractLinks);
  }

  if (eventId === null) mount(feedApp, { props: { userName: persona.name, backendName: __MATRIX_BACKEND__ } });
  else mount(eventApp, { props: { eventId, userId: persona.userId, userName: persona.name, backendName: __MATRIX_BACKEND__ } });
  status('Ready', 'ready');
  return { backend: __MATRIX_BACKEND__, authoring: 'contract', screen: eventId ? 'event' : 'feed', eventId };
}

const ready = boot().catch((error) => { console.error('[partiful-matrix/contract] boot failed', error); status(`Boot failed: ${error instanceof Error ? error.message : String(error)}`, 'error'); throw error; });
(globalThis as { partifulMatrixReady?: unknown }).partifulMatrixReady = ready;

if (import.meta.hot) import.meta.hot.dispose(() => { active?.dispose?.(); active = null; resetMatrixContractLinks(); reset(); });
