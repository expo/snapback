import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackClient } from '@expo/snapback-client';
import { App } from './App';
import './styles.css';

declare const __SNAPBACK_API_ORIGIN__: string;

const client = new SnapbackClient(__SNAPBACK_API_ORIGIN__, { offlineQueue: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode><App client={client} /></StrictMode>,
);
