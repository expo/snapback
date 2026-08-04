import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';

import { App } from './App';
import './styles.css';

declare const __SNAPBACK_API_ORIGIN__: string;

const coordinator = new AuthCoordinator({
  appId: 'triage-graph',
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

createRoot(document.getElementById('root')!).render(
  <StrictMode><App client={client as never} /></StrictMode>,
);
