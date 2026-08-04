import {
  SnapbackClient,
  type ReactBindingDevelopmentSyncState,
} from '@expo/snapback-client';
import { createSnapbackReactProvider } from '@chirp/snapback-react';
import api from '@generated/api.mjs';
import schema from '@generated/schema.manifest.json';
import functions from '@generated/functions.manifest.json';
import capabilityManifest from '@generated/capability.manifest.json';

export { api };

export async function createProvider(
  onDevelopmentSync?: (state: ReactBindingDevelopmentSyncState) => void,
) {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:3766';
  const client = new SnapbackClient(origin);
  const binding = await client.prepareReactBinding({
    generatedManifest: { schema, functions, capabilityManifest },
    developmentSync: onDevelopmentSync
      ? { onStateChange: onDevelopmentSync }
      : undefined,
  });
  return createSnapbackReactProvider(binding, { connectionId: 'chirp-expo' });
}
