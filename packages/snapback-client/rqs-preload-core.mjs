// Lightweight Channel A preload and legacy registered-boot registries.
// Mixed-route v2 verification is deliberately exposed from the opt-in
// `rqs-registered` entry: its artifact, authorization, and plan validators do
// not belong in the ordinary preload or client-root closure.
//
// @ref LLP 0166#d9--carriers-storage-profiles-arms-and-the-bundle — the
// public preload entry retains its frozen lightweight closure.

import { rqsEntryKey } from './rqs-store.mjs';

export const RQS_BOOT_ELEMENT_ID = '__snapback_boot';

export function readInlineBootPayload({
  document = globalThis.document,
  elementId = RQS_BOOT_ELEMENT_ID,
} = {}) {
  const element = document?.getElementById?.(elementId);
  if (!element) return null;
  try {
    const parsed = JSON.parse(element.textContent);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function createRqsPreloadRegistry(payload) {
  const entries = new Map();
  for (const entry of payload?.entries ?? []) {
    if (!entry || typeof entry.function !== 'string') continue;
    if (!entry.resume || typeof entry.resume.token !== 'string' || !entry.resume.meta) continue;
    const key = rqsEntryKey(entry.function, entry.args ?? {});
    if (key === null) continue;
    entries.set(key, {
      rows: Array.isArray(entry.rows) ? entry.rows : [],
      resume: entry.resume,
    });
  }
  return {
    route: typeof payload?.route === 'string' ? payload.route : null,
    generation: typeof payload?.generation === 'string' ? payload.generation : null,
    versionStream: typeof payload?.versionStream === 'string' ? payload.versionStream : null,
    get size() {
      return entries.size;
    },
    lookup(name, args = {}) {
      const key = rqsEntryKey(name, args);
      return key === null ? null : entries.get(key) ?? null;
    },
    consume(name, args = {}) {
      const key = rqsEntryKey(name, args);
      if (key === null) return null;
      const entry = entries.get(key) ?? null;
      if (entry !== null) entries.delete(key);
      return entry;
    },
  };
}

export function readRqsPreloadRegistry(options = {}) {
  return createRqsPreloadRegistry(readInlineBootPayload(options));
}

// LLP 0090 D4's original format-1 registry stays on the historical root and
// preload API. Format-2 mixed groups use the opt-in rqs-registered entry.
export function createRqsRegisteredRegistry(bundle) {
  const entries = new Map();
  const commitVersion = typeof bundle?.commitVersion === 'number' ? bundle.commitVersion : 0;
  const attachDeadline = Number.isSafeInteger(bundle?.connection?.attachDeadline)
    && bundle.connection.attachDeadline >= 0
    ? bundle.connection.attachDeadline
    : null;
  const connection = typeof bundle?.connection?.connectionId === 'string'
    && bundle.connection.connectionId.length > 0
    && typeof bundle.connection.grant === 'string'
    && bundle.connection.grant.length > 0
    ? {
        connectionId: bundle.connection.connectionId,
        grant: bundle.connection.grant,
        attachDeadline,
      }
    : null;
  for (const entry of bundle?.entries ?? []) {
    if (!entry || typeof entry.function !== 'string') continue;
    if (typeof entry.subscriptionId !== 'string' || entry.subscriptionId.length === 0) continue;
    const key = rqsEntryKey(entry.function, entry.args ?? {});
    if (key === null) continue;
    entries.set(key, {
      subscriptionId: entry.subscriptionId,
      rows: Array.isArray(entry.rows) ? entry.rows : [],
      version: commitVersion,
      resume: entry.resume && typeof entry.resume.token === 'string' ? entry.resume : null,
      attachDeadline,
    });
  }
  return {
    connection,
    generation: typeof bundle?.generation === 'string' ? bundle.generation : null,
    versionStream: typeof bundle?.versionStream === 'string' ? bundle.versionStream : null,
    get size() {
      return entries.size;
    },
    lookup(name, args = {}) {
      const key = rqsEntryKey(name, args);
      return key === null ? null : entries.get(key) ?? null;
    },
    consume(name, args = {}) {
      const key = rqsEntryKey(name, args);
      if (key === null) return null;
      const entry = entries.get(key) ?? null;
      if (entry !== null) entries.delete(key);
      return entry;
    },
  };
}
