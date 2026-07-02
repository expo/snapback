// Snapback admin Contract console entrypoint.
//
// Boot: install the Contract web host, build an AdminClient pointed at this
// origin's /_snapback/api/*, hydrate the reactive boundary from the admin
// contract, wire the link slot, and mount. In production the bundle and the API
// are served by the same Rust server on one origin — no dev proxy.

import * as contractRuntime from '@exact/contract/runtime';
import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import { AdminClient } from '../packages/snapback-admin-client/index.mjs';
import { createAdminSurface } from './admin-boundary.mjs';
import app from './app.contract';
import {
  configureAdminContractLinks,
  resetAdminContractLinks,
} from './generated/contract/runtime-links';

let currentSurface: { dispose: () => void } | null = null;

function adminBaseUrl(): string {
  if (typeof location !== 'undefined' && location.origin) {
    return `${location.origin}/_snapback/api`;
  }
  return '/_snapback/api';
}

function showFatal(message: string): void {
  if (typeof document === 'undefined') {
    console.error(`[snapback-admin] ${message}`);
    return;
  }
  const root = document.getElementById('exact-root');
  if (root) {
    root.innerHTML = `<pre style="margin:24px;color:#c0362c;font:13px ui-monospace,Menlo,monospace;white-space:pre-wrap">Admin console failed to start:\n${message}</pre>`;
  }
}

async function boot(): Promise<void> {
  installContractWebHost();
  const client = new AdminClient(adminBaseUrl());
  const surface = await createAdminSurface({
    runtime: contractRuntime,
    client,
  });
  currentSurface = surface;
  configureAdminContractLinks(surface.links);
  mount(app);
}

boot().catch((error) => {
  console.error(error);
  showFatal(error instanceof Error ? error.message : String(error));
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    currentSurface?.dispose();
    currentSurface = null;
    resetAdminContractLinks();
    reset();
  });
}
