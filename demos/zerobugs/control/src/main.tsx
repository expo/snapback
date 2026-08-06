import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackClient } from '@expo/snapback-client';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';
import { snapbackBasePath } from 'virtual:snapback/dev';
import capabilityManifest from '../snapback/generated/capability.manifest.json';
import functions from '../snapback/generated/functions.manifest.json';
import schema from '../snapback/generated/schema.manifest.json';
import { App } from './App';
import './styles.css';

const client = new SnapbackClient(snapbackBasePath);
const binding = await client.prepareReactBinding({
  generatedManifest: { schema, functions, capabilityManifest },
});
const provider = createSnapbackReactProvider(binding);
const root = document.getElementById('root');

if (!root) {
  throw new Error('missing #root mount point');
}

createRoot(root).render(
  <StrictMode>
    <SnapbackProvider provider={provider}>
      <App />
    </SnapbackProvider>
  </StrictMode>,
);
