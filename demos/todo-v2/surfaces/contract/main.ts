import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { SnapbackClient } from '../../../_kit/client.mjs';
import { createSnapbackContractSurface } from '../../../../packages/snapback-contract/index.mjs';
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
import { todoOptimisticReducers } from './optimistic.mjs';

const ADA = 'user_ada';
let activeSurface: { dispose?: () => void } | null = null;

function snapbackBaseUrl(): string {
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
  await client.health();

  status('Loading schema, functions, and seed data...');
  await client.loadSchema(schemaManifest);
  await client.loadFunctions(functionsManifest);
  await client.reset();
  await client.seed(seed);

  status('Mounting Contract surface...');
  installContractWebHost();
  const surface = await createSnapbackContractSurface({
    queryName: 'listTodos',
    boundaryKey: 'todos',
    optimisticReducers: todoOptimisticReducers,
    runtime: await import('@exact/contract/runtime'),
    client,
    userId: ADA,
    manifest: contractDataManifest,
    artifactIndex,
    schemaManifest,
    functionManifest: functionsManifest,
  });
  activeSurface = surface;
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
    activeSurface?.dispose?.();
    activeSurface = null;
    resetSnapbackContractLinks();
    reset();
  });
}
