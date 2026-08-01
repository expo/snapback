// Shared helpers for A1 offline phase child processes.
// Each phase is a genuinely cold node process: fresh VM, fresh client,
// durable state only through SNAPBACK_CLIENT_RQS_DIR.
import { writeFileSync } from 'node:fs';
import { SnapbackClient } from '@expo/snapback-client';

export const env = (name, fallback = undefined) => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing env ${name}`);
  }
  return value;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout: ${label}`);
    await sleep(30);
  }
}

export function makeClient({ offlineQueue } = {}) {
  return new SnapbackClient(env('A1_SERVER_URL'), {
    bearerToken: env('A1_BEARER'),
    authClientProtocol: 1,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: env('A1_STORE_ID'),
    ...(offlineQueue === undefined ? {} : { offlineQueue }),
  });
}

export function finish(out) {
  writeFileSync(env('A1_OUT'), JSON.stringify(out, null, 2));
  // Exit explicitly: live handles keep sockets/timers alive.
  process.exit(out.ok ? 0 : 1);
}

export function errorFacts(error) {
  return {
    message: String(error?.message ?? error),
    code: error?.diagnostic?.code ?? error?.code ?? null,
    name: error?.name ?? null,
  };
}
