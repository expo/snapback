import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createSnapbackAppClient } from '@expo/snapback-client';
import type { AuthBootstrapSnapshot } from '@expo/snapback-client';
import { SnapbackProvider } from '@expo/snapback-react/familiar';
import { App } from './App';
import { app } from '../snapback/generated/app.mjs';

const appClient = await createSnapbackAppClient({
  app,
  url: import.meta.env.VITE_SNAPBACK_URL,
  platform: 'browser',
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SnapbackProvider
      appClient={appClient}
      fallback={(state: AuthBootstrapSnapshot) => <p>Opening Snapback: {state.status}</p>}
    >
      <App />
    </SnapbackProvider>
  </StrictMode>,
);
