import { SnapbackClient } from '@expo/snapback-client';
import { createSnapbackReactProvider } from '@chirp/snapback-react';
import api from '@generated/api.mjs';
import schema from '@generated/schema.manifest.json';
import functions from '@generated/functions.manifest.json';
import capabilityManifest from '@generated/capability.manifest.json';

export { api };

export async function createProvider() {
  const origin = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:3766';
  const client = new SnapbackClient(origin);
  const binding = await client.prepareReactBinding({ generatedManifest: { schema, functions, capabilityManifest } });
  return createSnapbackReactProvider(binding, { connectionId: 'chirp-expo' });
}
