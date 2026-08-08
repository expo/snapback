import { SnapbackClient } from '@expo/snapback-client';
import {
  AuthCoordinator,
  createIndexedDbAuthCustodyStorage,
} from '@expo/snapback-contract';

import api from '../../snapback/generated/api.mjs';
import schema from '../../snapback/generated/schema.manifest.json';

const APP_ID = schema.appId;
const AUTH_CUSTODY_DATABASE_NAME = 'snapback-auth-custody';
const root = document.querySelector('#app');
const timeline = [];
let current = Object.freeze({ phase: 'loading', session: null, viewer: null, error: null });

// @ref LLP 0059#durable-custody-record — browser session custody uses the
// shipped IndexedDB/Web Locks adapter, so reconstructing this module after a
// full navigation restores the same coordinator-owned authority.
export const authCoordinator = new AuthCoordinator({
  appId: APP_ID,
  storage: createIndexedDbAuthCustodyStorage(),
});

export const client = new SnapbackClient('/__snapback', {
  authCoordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'browser-auth-recipe-web',
  rqsStore: null,
});

function publish(next) {
  current = Object.freeze(next);
  timeline.push(Object.freeze({
    ordinal: timeline.length + 1,
    phase: next.phase,
    principal: next.viewer?.principal ?? null,
  }));
  root.dataset.phase = next.phase;
  root.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = 'Browser auth recipe';
  root.append(heading);
  const status = document.createElement('p');
  status.id = 'status';
  status.textContent = next.phase;
  root.append(status);
  if (next.viewer) {
    const output = document.createElement('output');
    output.id = 'protected-viewer';
    output.dataset.private = 'true';
    output.dataset.principal = next.viewer.principal;
    output.dataset.issuer = next.viewer.externalIssuer;
    output.dataset.subject = next.viewer.externalSubject;
    output.textContent = `${next.viewer.displayName}\n${next.viewer.privateNote}`;
    root.append(output);
    const logoutButton = document.createElement('button');
    logoutButton.id = 'logout';
    logoutButton.textContent = 'Sign out';
    logoutButton.addEventListener('click', () => { void logout(); });
    root.append(logoutButton);
  } else if (next.phase === 'anonymous') {
    const login = document.createElement('a');
    login.id = 'sign-in';
    login.href = '/auth/start';
    login.textContent = 'Sign in through the external identity fixture';
    root.append(login);
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
    || session?.authority?.isAuthenticated === true;
}

async function refresh() {
  const session = await client.authSession({ force: true });
  if (!authenticated(session)) {
    publish({ phase: 'anonymous', session, viewer: null, error: null });
    return current;
  }
  const result = await client.query(api.viewer, { args: {} });
  if (result.rows.length !== 1) throw new Error('protected viewer query returned the wrong row count');
  publish({ phase: 'authenticated', session, viewer: result.rows[0], error: null });
  return current;
}

async function bootstrap() {
  try {
    const parameters = new URLSearchParams(location.search);
    if (parameters.get('login') === 'complete') {
      publish({ phase: 'transitioning', session: null, viewer: null, error: null });
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      });
      const exchange = await response.json();
      if (!response.ok) throw new Error(exchange?.error ?? 'login bootstrap was refused');
      await client.authExchange(exchange);
      history.replaceState(null, '', '/');
    }
    return await refresh();
  } catch (error) {
    publish({ phase: 'error', session: null, viewer: null, error: error?.message ?? String(error) });
    throw error;
  }
}

async function logout() {
  // App-visible private data is synchronously removed before the revocation
  // request is awaited; authLogout then carries the coordinator barrier.
  // @ref LLP 0059#transition-barrier — predecessor data is blank throughout
  // quiesce, durable replacement, server revocation, and successor resume.
  publish({ phase: 'transitioning', session: null, viewer: null, error: null });
  try {
    await client.authLogout();
    return await refresh();
  } catch (error) {
    publish({ phase: 'error', session: null, viewer: null, error: error?.message ?? String(error) });
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
      revision: record.revision,
      authorityEpoch: record.authorityEpoch,
      authorityKind: record.authority?.kind ?? null,
      bearerPresent: typeof record.bearer === 'string' && record.bearer.length > 0,
    });
  } finally {
    database.close();
  }
}

globalThis.snapbackBrowserAuth = Object.freeze({
  bootstrap,
  inspectCustody,
  logout,
  queryViewer: () => client.query(api.viewer, { args: {} }),
  snapshot: () => structuredClone(current),
  timeline: () => structuredClone(timeline),
});

await bootstrap();
