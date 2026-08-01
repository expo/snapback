// Offline queue phase: still offline. Queue a create and an update; both
// must return { queued: true, clientMutationId, sequence } and survive this
// process's death (phase-queue-inspect proves durability after restart).
import api from '../snapback/generated/api.mjs';
import { env, errorFacts, finish, makeClient } from './common.mjs';

const out = { phase: 'queue', pid: process.pid, ok: false };
try {
  // offlineQueue: true — REQUIRE outbox support, so a silent no-queue path
  // fails loudly instead of masquerading as success.
  const client = makeClient({ offlineQueue: true });
  out.rqsStoreInfo = client.rqsStoreInfo;

  const created = await client.mutate(api.createRecord, {
    args: {
      workspaceId: env('A1_WORKSPACE'),
      title: 'Valve inspection — queued offline',
      assigneeId: env('A1_ALICE_ID'),
      assigneeName: 'Alice',
      dueAt: 1785542400000,
      position: 4000,
      clientKey: 'a1-q1',
    },
  });
  out.queuedCreate = created;

  const updated = await client.mutate(api.updateRecord, {
    args: {
      recordId: env('A1_CONFLICT_RECORD'),
      notes: 'offline note from Alice (queued)',
    },
  });
  out.queuedUpdate = updated;

  out.outboxDiagnostics = client.outboxDiagnostics ?? null;
  out.ok = created?.queued === true
    && typeof created?.clientMutationId === 'string'
    && updated?.queued === true
    && updated?.sequence > created?.sequence;
} catch (error) {
  out.error = errorFacts(error);
}
finish(out);
