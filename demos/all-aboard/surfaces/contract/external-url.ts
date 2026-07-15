// All Aboard's one cross-platform URL-open capability.
//
// Exact native hosts expose the existing CapSec-admitted
// `desktop.shell.openExternal` operation. Plain browsers have no Exact host
// bridge, so they retain the ordinary window.open behavior used by the demo's
// popup-safe click handlers.

import { hostCallAsync } from '@exact/core/host-call-bridge';

export async function openExternalUrl(url: string): Promise<void> {
  if (typeof url !== 'string' || url.length === 0) return;

  const pending = hostCallAsync(
    'desktop.shell.openExternal',
    JSON.stringify({ url }),
  );
  if (pending) {
    await pending;
    return;
  }

  if (typeof globalThis.open === 'function') {
    globalThis.open(url, '_blank', 'noopener');
  }
}
