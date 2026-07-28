import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackClient } from '@snapback/client';
import { SnapbackProvider, createSnapbackReactProvider } from '@snapback/react';
import { App } from './App';
import functions from '../snapback/generated/functions.manifest.json';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';
import seed from '../snapback/seed.json';

declare const __SNAPBACK_URL__: string;

const client = new SnapbackClient(__SNAPBACK_URL__);
await client.ensureApp({ schema, functions, seed });
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SnapbackProvider provider={provider}><App /></SnapbackProvider>
  </StrictMode>,
);
