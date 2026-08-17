import {
  SnapbackClient,
  type ReactBindingDevelopmentSyncState,
} from '@expo/snapback-client';
import { createSnapbackReactProvider } from '@messenger/snapback-react';
import api, { app } from '@generated/api.mjs';

export { api };

export async function createProvider(
  onDevelopmentSync?: (state: ReactBindingDevelopmentSyncState) => void,
) {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4421';
  const client = new SnapbackClient(origin);
  const binding = await client.prepareReactBinding({
    generatedManifest: app,
    developmentSync: onDevelopmentSync
      ? { onStateChange: onDevelopmentSync }
      : undefined,
  });
  return {
    client,
    provider: createSnapbackReactProvider(binding, { connectionId: 'messenger-expo' }),
  };
}

export function publicAssetUrl(assetId: string, variant: 'primary' | 'thumb' = 'primary') {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4421';
  return `${origin}/assets/public/${encodeURIComponent(assetId)}/${variant}`;
}
