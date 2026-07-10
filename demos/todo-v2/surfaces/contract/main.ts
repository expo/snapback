import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  createLocalStorageSnapbackClientStore,
  createSnapbackContractSurface,
} from '../../../../packages/snapback-contract/index.mjs';
import artifactIndex from '../../snapback/generated/artifacts.json';
import contractDataManifest from '../../snapback/generated/contract-data.manifest.json';
import functionsManifest from '../../snapback/generated/functions.manifest.json';
import schemaManifest from '../../snapback/generated/schema.manifest.json';
import seed from '../../snapback/seed.json';
import app from './todo.contract';
import {
  configureSnapbackContractLinks,
  resetSnapbackContractLinks,
} from '../../snapback/generated/contract/runtime-links';

const ADA = 'user_ada';
let activeSurface: { dispose?: () => void } | null = null;
let activeReconnect: (() => void) | null = null;

// Build-time API origin injected by vite.config.ts `define`.
declare const __SNAPBACK_API_ORIGIN__: string | undefined;

function snapbackBaseUrl(): string {
  // Prefer the direct API origin (live WebSocket + HTTP under loopback CORS;
  // the bun-vite proxy cannot complete WebSocket upgrades, and a hung upgrade
  // wedges subsequent proxied HTTP too — see vite.config.ts and the
  // all-aboard surface this mirrors).
  if (__SNAPBACK_API_ORIGIN__ === 'same-origin') {
    return '';
  }
  if (typeof __SNAPBACK_API_ORIGIN__ === 'string' && __SNAPBACK_API_ORIGIN__.length > 0) {
    return __SNAPBACK_API_ORIGIN__;
  }
  const serverOrigin = (globalThis as { __exactServerOrigin?: string }).__exactServerOrigin;
  return typeof serverOrigin === 'string' && serverOrigin.length > 0
    ? `${serverOrigin}/snapback`
    : '/snapback';
}

function ensureBootStatusElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById('boot-status');
  if (existing) return existing;

  const style = document.createElement('style');
  style.textContent = `
    #boot-status {
      position: fixed;
      left: 16px;
      bottom: 16px;
      max-width: min(520px, calc(100vw - 32px));
      padding: 10px 12px;
      border: 1px solid #d7dce2;
      border-radius: 6px;
      background: #ffffff;
      color: #2a3038;
      font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
    }
    #boot-status[data-state="ready"] { display: none; }
    #boot-status[data-state="error"] {
      border-color: #e2a1a1;
      color: #8a1f1f;
    }
  `;
  document.head.append(style);

  const el = document.createElement('div');
  el.id = 'boot-status';
  document.body.append(el);
  return el;
}

function status(message: string, state: 'booting' | 'ready' | 'error' = 'booting'): void {
  if (typeof document === 'undefined') {
    console.log(`[snapback-todo-v2] ${message}`);
    return;
  }
  const el = ensureBootStatusElement();
  if (!el) return;
  el.textContent = message;
  el.dataset.state = state;
}

async function boot(): Promise<void> {
  status('Connecting to Snapback...');
  const client = new SnapbackClient(snapbackBaseUrl());
  const clientStore = createLocalStorageSnapbackClientStore({
    key: 'snapback.todo-v2.client-store.v1',
  });

  // Single idempotent mount-lifecycle ensure (LLP 0034 §5 / ENG-22527):
  // provisions only what is missing, seeds only when the todos table is
  // empty — the boot-path reset is gone (D4 edit 1), so a reload preserves
  // your data.
  try {
    await client.health();
    status('Ensuring backend provisioning...');
    await client.ensureApp({ schema: schemaManifest, functions: functionsManifest, seed });
  } catch {
    // The surface below may still boot from an authorized retained snapshot.
    // If this is a first run (nothing retained), construction fails with the
    // original network error instead of inventing an empty app.
    status('Backend unavailable — checking retained data...');
  }

  status('Mounting Contract surface...');
  installContractWebHost();
  const surface = await createSnapbackContractSurface({
    queryName: 'listTodos',
    boundaryKey: 'todos',
    // No hand-written reducers: todo-v2's mutations are IR-tier, so the
    // adapter derives their optimistic overlays from the manifest-embedded
    // plans (Exact LLP 0329 E-B). Apps may still pass optimisticReducers to
    // override per mutation.
    runtime: await import('@exact/contract/runtime'),
    client,
    clientStore,
    userId: ADA,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
  });
  activeSurface = surface;
  const reconnect = () => {
    void surface.reconnect?.().catch((error: unknown) => {
      console.warn('[snapback-todo-v2] reconnect replay deferred', error);
    });
  };
  activeReconnect = reconnect;
  globalThis.addEventListener?.('online', reconnect);
  configureSnapbackContractLinks(surface.links);
  mount(app);
  status('Ready', 'ready');
}

boot().catch((error) => {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  status(`Boot failed: ${message}`, 'error');
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (activeReconnect) globalThis.removeEventListener?.('online', activeReconnect);
    activeReconnect = null;
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
