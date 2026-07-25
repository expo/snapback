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
