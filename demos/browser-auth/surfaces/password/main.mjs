import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createIndexedDbAuthCustodyStorage,
} from '@expo/snapback-contract';

import schema from '../../snapback/generated/schema.manifest.json';

const APP_ID = schema.appId;
const AUTH_CUSTODY_DATABASE_NAME = 'snapback-auth-custody';
const root = document.querySelector('#app');
let current = Object.freeze({ phase: 'loading', session: null, error: null });

// @ref LLP 0059#durable-custody-record — the real IndexedDB adapter owns the
// password-issued bearer across a complete module/page reconstruction.
export const authCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createIndexedDbAuthCustodyStorage(),
});

export const client = new SnapbackClient('/__snapback', {
  authCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'browser-password-auth-custody',
  rqsStore: null,
  offlineQueue: false,
});

function publish(next) {
  current = Object.freeze(next);
  root.dataset.phase = next.phase;
  root.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = 'Password auth custody witness';
  root.append(heading);
  const status = document.createElement('output');
  status.id = 'status';
  status.textContent = next.phase;
  root.append(status);
  if (next.session?.authority?.userId) {
    const principal = document.createElement('output');
    principal.id = 'authenticated-principal';
    principal.textContent = next.session.authority.userId;
    root.append(principal);
  }
  if (next.error) {
    const error = document.createElement('pre');
    error.id = 'auth-error';
    error.textContent = next.error;
    root.append(error);
  }
}

function authenticated(session) {
  return session?.authority?.kind === 'session'
    || session?.authority?.kind === 'humanSession'
    || session?.authority?.isAuthenticated === true;
}

async function settle() {
  const session = await client.authSession({ force: true });
  publish({ phase: authenticated(session) ? 'authenticated' : 'anonymous', session, error: null });
  return current;
}

async function runTransition(operation) {
  publish({ phase: 'transitioning', session: null, error: null });
  try {
    await operation();
    return settle();
  } catch (error) {
    publish({ phase: 'error', session: null, error: error?.message ?? String(error) });
    throw error;
  }
}

function indexedDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function inspectCustody() {
  const database = await indexedDbRequest(indexedDB.open(AUTH_CUSTODY_DATABASE_NAME));
  try {
    if (!database.objectStoreNames.contains('custody')) return null;
    const transaction = database.transaction('custody', 'readonly');
    const record = await indexedDbRequest(transaction.objectStore('custody').get(APP_ID));
    if (!record) return null;
    return Object.freeze({
      appId: record.appId,
      phase: record.phase,
      authorityKind: record.authority?.kind ?? null,
      userId: record.authority?.userId ?? null,
      sessionId: record.authority?.sessionId ?? null,
      bearerPresent: typeof record.bearer === 'string' && record.bearer.length > 0,
    });
  } finally {
    database.close();
  }
}

globalThis.snapbackPasswordAuth = Object.freeze({
  signup: (email, password) => runTransition(() => client.authPasswordSignup({ email, password })),
  signin: (email, password) => runTransition(() => client.authPasswordSignIn({ email, password })),
  logout: () => runTransition(() => client.authLogout()),
  inspectCustody,
  snapshot: () => structuredClone(current),
});

try {
  await settle();
} catch (error) {
  publish({ phase: 'error', session: null, error: error?.message ?? String(error) });
  throw error;
}
