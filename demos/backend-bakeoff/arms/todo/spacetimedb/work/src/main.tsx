import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, type ErrorContext } from './module_bindings/index.ts';

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST;
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME;
const requestedPersona = new URLSearchParams(window.location.search).get('persona') ?? 'alice';
const tokens: Record<string, string> = {
  alice: import.meta.env.VITE_SPACETIMEDB_ALICE_TOKEN,
  bob: import.meta.env.VITE_SPACETIMEDB_BOB_TOKEN,
  mallory: import.meta.env.VITE_SPACETIMEDB_MALLORY_TOKEN,
};
const TOKEN = sessionStorage.getItem('llp0102-spacetimedb-signed-out')
  ? undefined
  : tokens[requestedPersona] ?? tokens.alice;

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(TOKEN)
  .onConnect((_connection, _identity, _token) => undefined)
  .onDisconnect(() => undefined)
  .onConnectError((_ctx: ErrorContext, error: Error) => {
    console.error('SpacetimeDB connection failed:', error.message);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>
);
