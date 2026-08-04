// Snapback admin Contract console entrypoint.
//
// Boot: install the Contract web host, build an AdminClient pointed at this
// origin's /_snapback/api/*, hydrate the reactive boundary from the admin
// contract, wire the link slot, and mount. In production the bundle and the API
// are served by the same Rust server on one origin — no dev proxy.

import * as contractRuntime from '@exact/contract/runtime';
import { mount, reset } from '@exact/contract/runtime';
import { installContractWebHost } from '@exact/renderer/web-host';

import {
  AdminClient,
  consumeConsoleCredentialFragment,
} from '../packages/snapback-admin-client/index.mjs';
import { createAdminSurface } from './admin-boundary.mjs';
import {
  renderAdminTokenPrompt,
  renderSessionCredentialsPrompt,
} from './auth-prompt.mjs';
import { renderFatal } from './fatal.mjs';
import app from './app.contract';
import {
  configureAdminContractLinks,
  resetAdminContractLinks,
} from './generated/contract/runtime-links';
import { applyDocumentColorScheme, systemTheme, watchSystemTheme } from './theme.ts';

let currentSurface: { dispose: () => void } | null = null;
let stopDocumentThemeSync: (() => void) | null = null;
let credentialRecoveryGeneration = 0;

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
  if (root) renderFatal(document, message);
}

function logFailure(failure: Error): void {
  const diagnostic = 'diagnostic' in failure && failure.diagnostic
    && typeof failure.diagnostic === 'object'
    ? failure.diagnostic as { code?: unknown }
    : null;
  const code = typeof diagnostic?.code === 'string' ? ` ${diagnostic.code}` : '';
  console.error(`[snapback-admin]${code}: ${failure.message}`);
}

async function boot(client: AdminClient): Promise<void> {
  const surface = await createAdminSurface({
    runtime: contractRuntime,
    client,
  });
  currentSurface = surface;
  configureAdminContractLinks(surface.links);
  mount(app);
}

async function start(): Promise<void> {
  installContractWebHost();
  // The console resolves its own color scheme; the document has to carry that
  // resolution too, because the renderer reads it (not the media query) when
  // it picks a themed image's source. Publish before the first mount so the
  // sidebar brand mark paints with the palette instead of one render behind
  // it, and keep it published as the host appearance changes.
  applyDocumentColorScheme(systemTheme());
  stopDocumentThemeSync = watchSystemTheme(applyDocumentColorScheme);
  const client = new AdminClient(adminBaseUrl());
  try {
    await consumeConsoleCredentialFragment(client);
    await boot(client);
  } catch (error) {
    const safe = client.sanitizeError(error);
    if (renderCredentialRecovery(client, safe)) return;
    logFailure(safe);
    showFatal(safe.message);
  }
}

function renderCredentialRecovery(client: AdminClient, failure: unknown): boolean {
  const safe = client.sanitizeError(failure);
  if (typeof document === 'undefined' || !isCredentialFailure(safe)) return false;
  const message = safe.message;
  const diagnostic = 'diagnostic' in safe
    ? safe.diagnostic
    : null;
  const code = diagnostic && typeof diagnostic === 'object' && 'code' in diagnostic
    ? diagnostic.code
    : '';

  if (code === 'SNAPBACK_ADMIN_SECRET_READ_REQUIRED') {
    return renderSessionCredentialsPrompt(document, {
      message,
      onSubmit: async ({
        adminToken,
        secretReadLease,
      }: {
        adminToken: string;
        secretReadLease: string;
      }) => {
        await client.setToken(adminToken);
        client.setSecretReadLease(secretReadLease);
        try {
          await boot(client);
        } catch (next) {
          if (!renderCredentialRecovery(client, next)) {
            throw client.sanitizeError(next);
          }
        }
      },
    });
  }

  const generation = ++credentialRecoveryGeneration;
  return renderAdminTokenPrompt(document, {
    message,
    onDeviceFlow: (controls: {
      showCode: (code: string, command: string) => void;
      showStatus: (status: string) => void;
    }) => {
      void completeDeviceApproval(client, controls, generation);
    },
    onSubmit: async (token: string) => {
      credentialRecoveryGeneration += 1;
      await client.setToken(token);
      try {
        await boot(client);
      } catch (next) {
        if (!renderCredentialRecovery(client, next)) {
          throw client.sanitizeError(next);
        }
      }
    },
  });
}

async function completeDeviceApproval(
  client: AdminClient,
  controls: {
    showCode: (code: string, command: string) => void;
    showStatus: (status: string) => void;
  },
  generation: number,
): Promise<void> {
  try {
    const request = await client.requestConsoleApproval();
    if (generation !== credentialRecoveryGeneration) return;
    controls.showCode(
      request.userCode,
      `snapback admin approve ${request.userCode} --ready-file <path>`,
    );
    let intervalSeconds = request.interval;
    while (generation === credentialRecoveryGeneration) {
      await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
      if (generation !== credentialRecoveryGeneration) return;
      const result = await client.pollConsoleApproval(request.deviceCode);
      if (result.status === 'authorization_pending') {
        intervalSeconds = result.interval;
        continue;
      }
      controls.showStatus('Approved. Opening the admin console…');
      credentialRecoveryGeneration += 1;
      try {
        await boot(client);
      } catch (next) {
        if (!renderCredentialRecovery(client, next)) {
          throw client.sanitizeError(next);
        }
      }
      return;
    }
  } catch (failure) {
    if (generation === credentialRecoveryGeneration) {
      controls.showStatus(client.sanitizeError(failure).message);
    }
  }
}

function isCredentialFailure(failure: unknown): boolean {
  if (!failure || typeof failure !== 'object' || !('status' in failure)) return false;
  if (failure.status === 401) return true;
  if (failure.status !== 403 || !('diagnostic' in failure)) return false;
  const diagnostic = failure.diagnostic;
  return !!(
    diagnostic &&
    typeof diagnostic === 'object' &&
    'code' in diagnostic &&
    diagnostic.code === 'SNAPBACK_ADMIN_DISABLED'
  );
}

start().catch((error) => {
  // This boundary runs only for pre-client bootstrap failures. Keep the
  // console and DOM projection scalar instead of retaining arbitrary Error
  // properties from dependencies.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[snapback-admin]: ${message}`);
  showFatal(message);
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    currentSurface?.dispose();
    currentSurface = null;
    stopDocumentThemeSync?.();
    stopDocumentThemeSync = null;
    resetAdminContractLinks();
    reset();
  });
}
