import {
  SnapbackClient,
  type ReactBindingDevelopmentSyncState,
} from '@expo/snapback-client';
import { createSnapbackReactProvider } from '@messenger/snapback-react';
import api from '@generated/api.mjs';
import schema from '@generated/schema.manifest.json';
import functions from '@generated/functions.manifest.json';
import capabilityManifest from '@generated/capability.manifest.json';

export { api };

// Captured on construction so hand-wired ephemeral (typing) subscriptions —
// which have no React hook, see guide/realtime/ephemeral-state.md — can
// reach the same client the provider is using.
let activeClient: SnapbackClient | null = null;
export function getSnapbackClient(): SnapbackClient | null {
  return activeClient;
}

export async function createProvider(
  onDevelopmentSync?: (state: ReactBindingDevelopmentSyncState) => void,
) {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4421';
  const client = new SnapbackClient(origin);
  activeClient = client;
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
    developmentSync: onDevelopmentSync
      ? { onStateChange: onDevelopmentSync }
      : undefined,
  });
  return createSnapbackReactProvider(binding, { connectionId: 'messenger-expo' });
}

export function publicAssetUrl(assetId: string, variant: 'primary' | 'thumb' = 'primary') {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4421';
  return `${origin}/assets/public/${encodeURIComponent(assetId)}/${variant}`;
}
