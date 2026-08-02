// Channel B persisted RQS resume store — in-memory fallback arm.
//
// The graceful-degradation arm of the default client store (LLP 0129
// Phase 0 / LLP 0008 DK-9: "if a persistent store is unavailable, the client
// should degrade to in-memory rather than fail silently"). Same observable
// contract as the IndexedDB and file arms — including the LLP 0043 M2
// outbox — but nothing survives the process: `durable: false` is the honest
// capability fact callers must project (no cold-boot retention claim, no
// restart-safe queue claim, warm-session queueing only).

import {
  allOutboxRecords,
  emptyOutboxState,
  outboxNotWriterError,
  outboxOps,
  pendingAcknowledgementsFor,
  pendingOutboxRecords,
} from './outbox-shared.mjs';
import {
  prepareReactBindingReceipt,
  rqsEntryRecordBytes,
  rqsEvictionOrder,
  RQS_STORE_MAX_BYTES,
  RQS_STORE_MAX_ENTRIES,
} from './rqs-store.mjs';

export function createMemoryRqsResumeStore({
  now = () => Date.now(),
  maxBytes = RQS_STORE_MAX_BYTES,
  maxEntries = RQS_STORE_MAX_ENTRIES,
  relaunchOutboxEmpty = null,
} = {}) {
  const entries = new Map();
  let outbox = emptyOutboxState();
  let reactBindingReceipt = null;
  let closed = false;

  const requireOpen = () => {
    if (closed) {
      const error = new Error('SNAPBACK_RQS_STORE_CLOSED: RQS resume store is closed');
      error.code = 'SNAPBACK_RQS_STORE_CLOSED';
      throw error;
    }
  };

  const requireWriter = () => {
    requireOpen();
  };

  return {
    /// The memory arm is always its own (sole) writer while open.
    isWriter() {
      return !closed;
    },

    whenLockSettled() {
      return Promise.resolve();
    },

    /// Degradation-mode capability fact (DK-9: capability reports name the
    /// store implementation and degradation mode in force).
    durability() {
      return { implementation: 'memory', durable: false };
    },

    async outboxEmpty() {
      requireOpen();
      if (relaunchOutboxEmpty !== null && (await relaunchOutboxEmpty()) !== true) return false;
      return pendingOutboxRecords(outbox).length === 0;
    },

    async loadReactBindingReceipt() {
      requireOpen();
      return reactBindingReceipt === null ? null : structuredClone(reactBindingReceipt);
    },

    async commitReactBindingReceipt(receipt) {
      requireWriter();
      const stored = prepareReactBindingReceipt(receipt);
      if (stored === null) return false;
      reactBindingReceipt = stored;
      return true;
    },

    async load(key) {
      requireOpen();
      if (typeof key !== 'string' || key.length === 0) return null;
      const record = entries.get(key);
      return record === undefined ? null : structuredClone(record);
    },

    async commit(key, { rows, meta, token }) {
      requireOpen();
      if (typeof key !== 'string' || key.length === 0) return { persisted: false, reason: 'key' };
      const bytes = rqsEntryRecordBytes({ rows, meta, token });
      if (bytes > maxBytes) {
        entries.delete(key);
        return { persisted: false, reason: 'oversize' };
      }
      const existing = entries.get(key);
      entries.set(key, structuredClone({
        rows,
        meta,
        token,
        bytes,
        savedAt: now(),
        resumedAt: existing?.resumedAt ?? 0,
        inProgress: false,
      }));
      const evicted = [];
      let totalBytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      const evictable = [...entries.entries()]
        .filter(([candidateKey]) => candidateKey !== key)
        .map(([candidateKey, entry]) => ({ key: candidateKey, ...entry }))
        .sort(rqsEvictionOrder);
      while ((totalBytes > maxBytes || entries.size > maxEntries) && evictable.length > 0) {
        const victim = evictable.shift();
        entries.delete(victim.key);
        totalBytes -= victim.bytes;
        evicted.push(victim.key);
      }
      return { persisted: true, reason: null, bytes, evicted };
    },

    async markInProgress(key) {
      requireOpen();
      const existing = entries.get(key);
      if (existing === undefined) return false;
      entries.set(key, { ...existing, inProgress: true });
      return true;
    },

    async markResumed(key, at = now()) {
      requireOpen();
      const existing = entries.get(key);
      if (existing === undefined) return false;
      entries.set(key, { ...existing, resumedAt: at });
      return true;
    },

    async remove(key) {
      requireOpen();
      entries.delete(key);
      return true;
    },

    /// User-switch wipe (LLP 0053 semantics): retained entries AND the
    /// queued-intent outbox — another identity must never replay this one's
    /// queued mutations.
    async wipe() {
      requireOpen();
      entries.clear();
      outbox = emptyOutboxState();
      reactBindingReceipt = null;
      return true;
    },

    // ---- LLP 0043 M2 outbox ----

    async outboxEnqueue(record) {
      requireWriter();
      const applied = outboxOps.enqueue(outbox, record, now());
      outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxPending() {
      requireOpen();
      return structuredClone(pendingOutboxRecords(outbox));
    },

    async outboxPrepareSubmission(id) {
      requireWriter();
      const applied = outboxOps.prepareSubmission(outbox, id);
      outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxRecords() {
      requireOpen();
      return structuredClone(allOutboxRecords(outbox));
    },

    async outboxSettle(id) {
      requireWriter();
      const applied = outboxOps.settle(outbox, id);
      outbox = applied.state;
      return applied.result;
    },

    async outboxDurablyConsume(id, settlement, userId = null, confirmedAcknowledgements = []) {
      requireWriter();
      const applied = outboxOps.durablyConsume(
        outbox,
        id,
        settlement,
        userId,
        now(),
        confirmedAcknowledgements,
      );
      outbox = applied.state;
      return structuredClone(applied.result);
    },

    async outboxMarkFailed(id, failure) {
      requireWriter();
      const applied = outboxOps.markFailed(outbox, id, failure);
      outbox = applied.state;
      return applied.result;
    },

    async outboxDiscard(id) {
      requireWriter();
      const applied = outboxOps.discard(outbox, id);
      outbox = applied.state;
      return applied.result;
    },

    async outboxRecordAcknowledgement(id, userId = null, authorityDescriptor = null) {
      requireWriter();
      const applied = outboxOps.recordAck(outbox, id, userId, authorityDescriptor);
      outbox = applied.state;
      return applied.result;
    },

    async outboxPendingAcknowledgements(userId = null, limit = 64, authorityDescriptor = null) {
      requireOpen();
      return pendingAcknowledgementsFor(outbox, userId, limit, authorityDescriptor);
    },

    async outboxMarkAcknowledgementsReady(ids, userId = undefined, authorityDescriptor = undefined) {
      requireWriter();
      const applied = outboxOps.markAcksReady(outbox, ids, userId, authorityDescriptor);
      outbox = applied.state;
      return applied.result;
    },

    async outboxConfirmAcknowledgements(ids, userId = undefined, authorityDescriptor = undefined) {
      requireWriter();
      const applied = outboxOps.confirmAcks(outbox, ids, userId, authorityDescriptor);
      outbox = applied.state;
      return applied.result;
    },

    async inspection() {
      requireOpen();
      const all = [...entries.values()];
      return Object.freeze({
        writer: this.isWriter(),
        entries: entries.size,
        bytes: all.reduce((sum, entry) => sum + entry.bytes, 0),
        maxBytes,
        maxEntries,
        outbox: Object.freeze({
          pending: pendingOutboxRecords(outbox).length,
          failed: allOutboxRecords(outbox).filter((r) => r.status === 'failed').length,
          pendingAcknowledgements: outbox.acks.length,
        }),
      });
    },

    async close() {
      closed = true;
    },
  };
}

// The not-writer error is constructed here so arm-specific stores share one
// exact refusal shape; the memory arm itself is always the writer.
export { outboxNotWriterError };
