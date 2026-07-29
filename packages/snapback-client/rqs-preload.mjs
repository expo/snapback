// Channel A boot-payload consumption (LLP 0090 D2 rollout step 3,
// ENG-25454; contract LLP 0092 §0E.1/§0C.5).
//
// The serving seam embeds the read-mode bundle response as a non-executable
// `<script type="application/json" id="__snapback_boot">` data block. This
// module reads it before mount and builds the preload registry keyed by the
// canonical authority-independent alias key (`rqsEntryKey` — query name +
// JCS args, deliberately no authority component), so an anonymously minted
// preload is consumable under any authenticated store identity without a
// duplicate store or subscription. Entries are handed to the kit's
// `preloadedResume` seam, which digest-verifies and arbitrates against
// Channel B persisted state before anything renders (retained/pending until
// the first authoritative answer).

import { rqsEntryKey } from './rqs-store.mjs';

export const RQS_BOOT_ELEMENT_ID = '__snapback_boot';

/// Read and parse the embedded boot payload. The element's textContent is
/// `JSON.parse`d directly — the §0E.1 escapes decode transparently and no
/// other decoding step may run first. Returns null when absent or unparsable
/// (degraded pageloads simply have no payload).
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

/**
 * Build the preload registry from a boot payload. Only entries carrying a
 * `resume` object preload (`rqsEligible` per the closed union — a
 * server-minted token is the eligibility proof the alias-key promotion
 * check keys on, LLP 0092 §0C.5); `resume: null` entries never enter the
 * registry. `consume(name, args)` is one-shot so a store is seeded exactly
 * once per pageload.
 */
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

/// Convenience boot helper: read the document payload and return the
/// registry (an empty registry when no payload is embedded).
export function readRqsPreloadRegistry(options = {}) {
  return createRqsPreloadRegistry(readInlineBootPayload(options));
}

/**
 * Build a registered-boot registry from a register-mode bundle response
 * (LLP 0090 D4 rollout step 7; contract LLP 0092 §0D.1). Every register-mode
 * entry carries a `subscriptionId`; entries are keyed like the preload
 * registry and consumed one-shot into `liveQuery`'s `registeredSubscription`
 * seam, so each subscription is adopted exactly once per boot. The entry's
 * `version` is the bundle's single `commitVersion` (every snapshot was
 * evaluated at that one cut), and `resume` stays `null` for auth-scoped
 * entries — the closed union rides through unchanged.
 *
 * The connection facts (`connectionId`, `grant`, `attachDeadline`) are
 * surfaced so the boot can hand `connectionId` to its surface/handles; the
 * grant itself was already adopted into the client's connection-grant cache
 * by `fetchBundle`.
 */
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
      // @ref LLP 0092#0d4-attach-grace-reaping-and-pending-owner-bounds —
      // every adopted registration is usable only inside its bundle owner's
      // exact server-authored attach window.
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
