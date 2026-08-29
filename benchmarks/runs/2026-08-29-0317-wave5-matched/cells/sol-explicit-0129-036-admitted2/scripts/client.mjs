import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createSnapbackAppClient } from '@expo/snapback-client';
import { app } from '../snapback/generated/app.mjs';

const root = new URL('../', import.meta.url);

export function liveBinding() {
  const ready = JSON.parse(readFileSync(new URL('.snapback/dev.ready.json.application-ready', root), 'utf8'));
  return ready.binding;
}

export async function anonymousClient(databaseName = `clique-anonymous-${process.pid}-${Math.random()}`) {
  return createSnapbackAppClient({
    app,
    binding: liveBinding(),
    platform: Object.freeze({ kind: 'expo-web', indexedDB: new IDBFactory(), cryptoObject: webcrypto, databaseName }),
  });
}

export async function sessionClient({ email, password, signup = false, databaseName = `clique-${process.pid}-${Math.random()}` }) {
  const appClient = await anonymousClient(databaseName);
  // Node clients in one process can restore the durable application session.
  // Acceptance identities are explicit, so never silently inherit another one.
  if (appClient.auth.currentPrincipal().status === 'authenticated') await appClient.auth.signOut();
  if (signup) {
    try { await appClient.auth.signUpWithPassword({ email, password }); }
    catch (error) {
      if (appClient.auth.currentPrincipal().status !== 'authenticated') await appClient.auth.signInWithPassword({ email, password });
    }
  } else {
    await appClient.auth.signInWithPassword({ email, password });
  }
  return appClient;
}

export async function query(appClient, ref, args = {}) {
  return (await appClient.client.query(ref, { args })).rows;
}

export async function mutate(appClient, ref, args, clientMutationId = `cli-${process.pid}-${Date.now()}-${Math.random()}`) {
  // Transport mutation ids are scoped to the adopted auth generation. Domain
  // idempotency remains in the authored mutationId/externalId arguments.
  const transportMutationId = `${clientMutationId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return (await appClient.client.mutate(ref, { args, clientMutationId: transportMutationId })).result;
}
