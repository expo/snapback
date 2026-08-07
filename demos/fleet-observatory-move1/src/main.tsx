import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
} from '@expo/snapback-react';

import { app } from '../snapback/generated/api';
import { App } from './App';
import type { FleetAuthClient } from './App';
import './styles.css';

declare const __SNAPBACK_API_ORIGIN__: string;

const coordinator = new AuthCoordinator({
  appId: 'fleet-observatory-move1',
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__, {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  offlineQueue: false,
});
const binding = await client.prepareReactBinding({ generatedManifest: app });
const provider = createSnapbackReactProvider(binding);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SnapbackProvider provider={provider}>
      <App client={client as unknown as FleetAuthClient} />
    </SnapbackProvider>
  </StrictMode>,
);
