// Shindig — Contract surface bootstrap. The multi-live Snapback surface binds
// live queries with their args at boot (one subscription per query name,
// LLP 0034 §10.4), so screen selection happens here, from the URL: the feed
// screen binds myFeed; the event screen binds guestList/eventWall scoped to
// the ?event= id and mounts ShindigEvent with matching props. Dev-mode
// identity rides ?user= as in the React arm.

import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import feedApp from './feed.contract';
import eventApp from './event.contract';
import { PERSONAS } from './data.ts';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';

let activeSurface: { dispose?: () => void } | null = null;

declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  return '/snapback';
}

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  const el = document.getElementById('boot-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const requested = params.get('user');
  const persona = PERSONAS.find((p) => p.id === requested || p.userId === requested) ?? PERSONAS[0];
  const eventId = params.get('event');

  status('Connecting to Snapback…');
  const client = new SnapbackClient(snapbackBaseUrl());
  await client.health();
  status('Ensuring backend provisioning…');
  await client.ensureApp({ schema: schemaManifest, functions: functionsManifest });

  status('Mounting Contract surface…');
  installContractWebHost();
  const surface = await createSnapbackContractSurface({
    runtime: await import('@exact/contract/runtime'),
    client,
    userId: persona.userId,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
    liveQueries: eventId === null
      ? ['myFeed']
      : [
          { name: 'eventDetails', args: { eventId } },
          { name: 'guestList', args: { eventId } },
          { name: 'eventWall', args: { eventId } },
        ],
  });
  activeSurface = surface;
  configureSnapbackContractLinks(surface.links);
  if (eventId === null) {
    mount(feedApp, { props: { userName: persona.name } });
  } else {
    mount(eventApp, { props: { eventId, userId: persona.userId, userName: persona.name } });
  }
  status('Ready', 'ready');
  (globalThis as { shindigContract?: unknown }).shindigContract = {
    persona: persona.id,
    screen: eventId === null ? 'feed' : 'event',
    eventId,
  };
}

const ready = boot().catch((error) => {
  console.error('[shindig contract] boot failed', error);
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
  throw error;
});
(globalThis as { shindigContractReady?: unknown }).shindigContractReady = ready;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
