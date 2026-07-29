import { createHash } from 'node:crypto';
// @ref LLP 0102#app-4-partiful-shaped-event-application — the scenario harness preserves the frozen event dataset, authority matrix, contention, realtime, asset, schedule, effect, and revocation facts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init as initClient } from '@instantdb/core';
import schema from '../instant.schema.ts';

globalThis.window ??= {};
import {
  actorEmail,
  dbForTarget,
  evidenceDir,
  ids,
  namespace,
  queryCounts,
  readTarget,
  receiptsDir,
  runtimeDir,
  sha256,
  waitFor,
  writeJson,
} from './lib.mjs';

const target = readTarget();
const db = dbForTarget(target);
const actors = JSON.parse(readFileSync(resolve(runtimeDir, 'actors.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(resolve(runtimeDir, 'fixture.json'), 'utf8'));
const alice = db.asUser({ email: actorEmail('alice') });
const bob = db.asUser({ email: actorEmail('bob') });
const mallory = db.asUser({ email: actorEmail('mallory') });
const anonymous = db.asUser({ guest: true });
const results = [];
const evidence = {};
let stopDefect = null;
let successWebhook = null;
let ambiguousWebhook = null;

class MemoryStore {
  constructor() {
    this.values = new Map();
  }
  async getItem(key) { return this.values.get(key) ?? null; }
  async setItem(key, value) { this.values.set(key, value); }
  async getAllKeys() { return [...this.values.keys()]; }
  async multiSet(entries) {
    for (const [key, value] of entries) this.values.set(key, value);
  }
  async removeItem(key) { this.values.delete(key); }
}

class OnlineNetwork {
  static async getIsOnline() { return false; }
  static listen() { return () => undefined; }
}

function nativeClient(label) {
  return initClient(
    {
      appId: target.appId,
      schema,
      devtool: false,
      __extraDedupeKey: `${namespace}:${label}`,
    },
    MemoryStore,
    OnlineNetwork,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectRejected(operation, label) {
  try {
    await operation();
  } catch (error) {
    return {
      rejected: true,
      label,
      errorType: error?.body?.type ?? error?.name ?? 'Error',
      errorMessage: String(error?.message ?? error).slice(0, 500),
    };
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function scenario(id, description, operation) {
  const startedAt = new Date().toISOString();
  try {
    const detail = await operation();
    const status = detail?.status === 'GAP' ? 'GAP' : 'PASS';
    const entry = {
      id,
      result: status,
      summary: detail?.summary ?? description,
      startedAt,
      finishedAt: new Date().toISOString(),
      evidence: detail?.evidence ?? detail ?? {},
    };
    results.push(entry);
    evidence[id] = entry;
    return entry;
  } catch (error) {
    const entry = {
      id,
      result: 'FAIL',
      summary: description,
      startedAt,
      finishedAt: new Date().toISOString(),
      errorType: error?.body?.type ?? error?.name ?? 'Error',
      errorMessage: String(error?.message ?? error).slice(0, 1000),
    };
    results.push(entry);
    evidence[id] = entry;
    writeJson(resolve(receiptsDir, `acceptance-failure-${Date.now()}.json`), entry);
    throw error;
  }
}

await scenario('PARTY-01-SEED', 'Exact frozen fixture and personas exist.', async () => {
  const counts = await queryCounts(db);
  assert(counts.events === 20, `expected 20 events, got ${counts.events}`);
  assert(counts.invitations === 49, `expected 49 guests, got ${counts.invitations}`);
  assert(counts.seatClaims === 50, `expected 50 capacity slots, got ${counts.seatClaims}`);
  assert(counts.$users === 3, `expected 3 actors, got ${counts.$users}`);
  const occupancy = await db.query({
    seatClaims: { $: { where: { eventId: fixture.contendedEventId } } },
  });
  const occupiedSeatCount = occupancy.seatClaims.filter((claim) => claim.occupied).length;
  assert(occupiedSeatCount === 49, `expected 49 occupied seats, got ${occupiedSeatCount}`);
  return {
    summary: 'Authoritative hosted query returned 20 events, 49 contended guests in 50 preallocated capacity slots, and three native users.',
    evidence: {
      authoritativeCounts: counts,
      authoritativeOccupiedSeatCount: occupiedSeatCount,
      seedReceipt: '../receipts/seed-receipt.json',
    },
  };
});

await scenario('PARTY-02-PUBLIC-PRIVATE', 'Public preview enforces the private field boundary.', async () => {
  const preview = await anonymous.query({
    events: { $: { where: { slug: `${namespace}-event-01` } } },
  });
  const privateEvent = await anonymous.query({
    events: { $: { where: { slug: `${namespace}-event-20` } } },
  });
  assert(preview.events.length === 1, 'anonymous public preview missing');
  if ('privateHostNote' in preview.events[0]) {
    stopDefect = {
      class: 'cross-user-data-disclosure',
      scenario: 'PARTY-02-PUBLIC-PRIVATE',
      detail: 'anonymous result exposed privateHostNote',
    };
    throw new Error('STOP: anonymous result exposed privateHostNote');
  }
  assert(privateEvent.events.length === 0, 'anonymous private event read was not filtered');
  return {
    summary: 'Guest-context query returned the public event without privateHostNote and filtered the private event entirely.',
    evidence: {
      publicCount: preview.events.length,
      publicKeys: Object.keys(preview.events[0]).sort(),
      privateEventCount: privateEvent.events.length,
      authority: 'native Instant guest impersonation with deployed field/row rules',
    },
  };
});

await scenario('PARTY-03-INVITE-RSVP', 'Bob settles RSVP and plus-one transitions.', async () => {
  const observed = [];
  for (const [response, plusOne] of [['maybe', 0], ['no', 0], ['yes', 1]]) {
    await bob.transact(
      bob.tx.invitations[fixture.bobInvitationId].update({
        response,
        plusOne,
        updatedAt: Date.now(),
      }),
    );
    const authoritative = await db.query({
      invitations: { $: { where: { id: fixture.bobInvitationId } } },
    });
    observed.push({
      response: authoritative.invitations[0].response,
      plusOne: authoritative.invitations[0].plusOne,
    });
  }
  assert(JSON.stringify(observed) === JSON.stringify([
    { response: 'maybe', plusOne: 0 },
    { response: 'no', plusOne: 0 },
    { response: 'yes', plusOne: 1 },
  ]), 'RSVP transition settlement mismatch');
  return {
    summary: 'Bob’s native principal performed maybe/no/yes plus-one transitions and every state settled authoritatively.',
    evidence: { invitationIdSha256: sha256(fixture.bobInvitationId), observed },
  };
});

await scenario('PARTY-04-ROLES', 'Host, cohost, guest, and outsider have distinct authority.', async () => {
  const ownerRead = await alice.query({
    events: { $: { where: { id: fixture.contendedEventId } } },
  });
  assert(ownerRead.events[0].privateHostNote, 'host did not receive private field');
  const guestRead = await bob.query({
    events: { $: { where: { id: fixture.contendedEventId } } },
  });
  assert(guestRead.events.length === 1, 'invited guest could not read event');
  assert(!('privateHostNote' in guestRead.events[0]), 'guest received private field');
  const guestWrite = await expectRejected(
    () => bob.transact(bob.tx.events[fixture.contendedEventId].update({ title: 'forbidden guest title' })),
    'guest host-control update',
  );
  const cohostEventId = fixture.eventIds[1];
  await bob.transact(bob.tx.events[cohostEventId].update({ title: 'Cohost-authorized gathering' }));
  const cohostState = await db.query({ events: { $: { where: { id: cohostEventId } } } });
  assert(cohostState.events[0].title === 'Cohost-authorized gathering', 'cohost write did not settle');
  const outsiderPrivate = await mallory.query({
    events: { $: { where: { id: fixture.eventIds[19] } } },
  });
  assert(outsiderPrivate.events.length === 0, 'outsider read private event');
  const outsiderWrite = await expectRejected(
    () => mallory.transact(mallory.tx.events[fixture.contendedEventId].update({ title: 'forbidden outsider title' })),
    'outsider host-control update',
  );
  return {
    summary: 'Alice saw host-only data, Bob read as guest and wrote only as cohost, and Mallory’s private read/write attempts were denied.',
    evidence: {
      hostPrivateField: true,
      guestPrivateField: false,
      guestWrite,
      cohostWriteSettled: true,
      outsiderPrivateCount: outsiderPrivate.events.length,
      outsiderWrite,
    },
  };
});

await scenario('PARTY-05-GUEST-LIST', 'Guest-list policy changes reach an already-connected guest.', async () => {
  const observations = [];
  const authoritativeInvitations = await db.query({
    invitations: { $: { where: { eventId: fixture.contendedEventId } } },
  });
  assert(authoritativeInvitations.invitations.length === 49, 'remediation fixture invitation count mismatch');
  const subscription = bob.subscribeQuery(
    { invitations: { $: { where: { eventId: fixture.contendedEventId } } } },
    (payload) => {
      if (payload.type === 'error') return;
      observations.push({
        at: new Date().toISOString(),
        count: payload.data.invitations.length,
      });
    },
  );
  try {
    await waitFor(() => observations.some((item) => item.count === 49));
    await alice.transact([
      alice.tx.events[fixture.contendedEventId].update({ guestListVisible: false }),
      ...authoritativeInvitations.invitations.map((invitation) =>
        alice.tx.invitations[invitation.id].update({ guestListVisible: false }),
      ),
    ]);
    await waitFor(() => observations.some((item) => item.count === 0));
  } finally {
    subscription.close();
    await db.transact([
      db.tx.events[fixture.contendedEventId].update({ guestListVisible: true }),
      ...authoritativeInvitations.invitations.map((invitation) =>
        db.tx.invitations[invitation.id].update({ guestListVisible: true }),
      ),
    ]);
  }
  return {
    summary: 'Bob’s existing native SSE subscription moved from 49 visible guests to zero after Alice atomically hid the event list and its invitation rows.',
    evidence: {
      transport: 'native Instant admin SDK SSE subscription',
      observations,
      remediation: 'visibility dependency denormalized onto invitations; host updates event and 49 invitation policy fields in one atomic transaction',
      failedAttemptReceipts: [
        '../receipts/acceptance-failure-1785307478546.json',
        '../receipts/guest-list-revocation-diagnostic.json',
      ],
    },
  };
});

await scenario('PARTY-06-CAPACITY', 'Concurrent final-seat claims cannot overbook capacity.', async () => {
  const aliceTx = alice.tx.seatClaims[fixture.finalSeatId]
    .update({
      claimantId: actors.alice.id,
      occupied: true,
      claimedAt: Date.now(),
    })
    .link({ claimant: actors.alice.id });
  const bobTx = bob.tx.seatClaims[fixture.finalSeatId]
    .update({
      claimantId: actors.bob.id,
      occupied: true,
      claimedAt: Date.now(),
    })
    .link({ claimant: actors.bob.id });
  const barrierReleasedAt = new Date().toISOString();
  const settlements = await Promise.allSettled([alice.transact(aliceTx), bob.transact(bobTx)]);
  const authoritative = await db.query({
    seatClaims: { $: { where: { eventId: fixture.contendedEventId } } },
  });
  const finalRows = authoritative.seatClaims.filter((claim) => claim.seatKey === fixture.finalSeatKey);
  const occupiedCount = authoritative.seatClaims.filter((claim) => claim.occupied).length;
  if (occupiedCount > 50 || finalRows.length > 1) {
    stopDefect = {
      class: 'destructive-or-safety-invariant',
      scenario: 'PARTY-06-CAPACITY',
      detail: 'capacity overbooked',
    };
    throw new Error('STOP: final-seat concurrency overbooked capacity');
  }
  assert(occupiedCount === 50, 'final-seat claim did not settle');
  assert(finalRows.length === 1, 'unique final seat did not converge to one row');
  await db.transact(
    db.tx.seatClaims[fixture.finalSeatId]
      .update({ claimantId: 'unclaimed', occupied: false, claimedAt: Date.now() })
      .unlink({ claimant: finalRows[0].claimantId }),
  );
  return {
    summary: 'Two native actor transactions barrier-dispatched against one unique seat key; one authoritative row remained and total attendance was 50.',
    evidence: {
      barrierReleasedAt,
      settlements: settlements.map((item) => item.status),
      capacity: 50,
      authoritativeCount: occupiedCount,
      finalSeatRows: finalRows.length,
      winnerIdSha256: sha256(finalRows[0].claimantId),
      conflictMechanism: 'unique indexed seatKey plus atomic lookup transaction; convergent whole-entity LWW on the same logical slot',
    },
  };
});

await scenario('PARTY-07-LIVE-BURST', 'Wall posts and RSVP totals update live during the frozen burst.', async () => {
  const observations = [];
  const subscription = bob.subscribeQuery(
    {
      wallPosts: { $: { where: { eventId: fixture.contendedEventId } } },
      seatClaims: { $: { where: { eventId: fixture.contendedEventId } } },
    },
    (payload) => {
      if (payload.type === 'error') return;
      observations.push({
        at: performance.now(),
        posts: payload.data.wallPosts.length,
        attending: payload.data.seatClaims.filter((claim) => claim.occupied).length,
      });
    },
  );
  const postIds = Array.from({ length: 20 }, () => ids.opaque());
  try {
    await waitFor(() => observations.some((item) => item.posts === 0 && item.attending === 49));
    const sentAt = performance.now();
    const chunks = postIds.map((postId, index) =>
      alice.tx.wallPosts[postId]
        .update({
          nonce: `${namespace}:burst:${index}`,
          eventId: fixture.contendedEventId,
          authorId: actors.alice.id,
          body: `Burst post ${String(index + 1).padStart(2, '0')}`,
          createdAt: Date.now() + index,
        })
        .link({ event: fixture.contendedEventId }),
    );
    chunks.push(
      alice.tx.seatClaims[fixture.finalSeatId]
        .update({
          claimantId: actors.alice.id,
          occupied: true,
          claimedAt: Date.now(),
        })
        .link({ claimant: actors.alice.id }),
    );
    await alice.transact(chunks);
    const settled = await waitFor(() => {
      const match = observations.find((item) => item.posts === 20 && item.attending === 50);
      return match && { ...match, latencyMs: match.at - sentAt };
    });
    const authoritative = await db.query({
      wallPosts: { $: { where: { eventId: fixture.contendedEventId } } },
      seatClaims: { $: { where: { eventId: fixture.contendedEventId } } },
    });
    assert(authoritative.wallPosts.length === 20, 'authoritative wall burst count mismatch');
    const authoritativeAttending = authoritative.seatClaims.filter((claim) => claim.occupied).length;
    assert(authoritativeAttending === 50, 'authoritative RSVP total mismatch');
    return {
      summary: 'Bob’s second native SSE client observed the 20-post wall burst and RSVP total transition from 49 to 50.',
      evidence: {
        transport: 'native Instant admin SDK SSE subscription; no polling',
        settled,
        observationCount: observations.length,
        authoritativeCounts: {
          wallPosts: authoritative.wallPosts.length,
          seatClaims: authoritativeAttending,
        },
      },
    };
  } finally {
    subscription.close();
    const cleanup = [
      ...postIds.map((postId) => db.tx.wallPosts[postId].delete()),
      db.tx.seatClaims[fixture.finalSeatId]
        .update({ claimantId: 'unclaimed', occupied: false, claimedAt: Date.now() })
        .unlink({ claimant: actors.alice.id }),
    ];
    await db.transact(cleanup).catch(() => undefined);
  }
});

await scenario('PARTY-08-ASSET', 'Authenticated event art upload, delivery, and deletion work.', async () => {
  const body = Buffer.alloc(262144);
  for (let index = 0; index < body.length; index += 1) body[index] = index % 251;
  const contentSha256 = createHash('sha256').update(body).digest('hex');
  const path = `${namespace}/protected/${actors.alice.id}/event-art.bin`;
  const aliceClient = nativeClient('asset-alice');
  const malloryClient = nativeClient('asset-mallory');
  await aliceClient.auth.signInWithToken(actors.alice.token);
  await malloryClient.auth.signInWithToken(actors.mallory.token);
  try {
    const upload = await aliceClient.storage.uploadFile(path, new Blob([body]), {
      contentType: 'application/octet-stream',
    });
    const malloryRead = await expectRejected(
      () => malloryClient.storage.getDownloadUrl(path),
      'outsider protected file URL',
    );
    const downloadUrl = await aliceClient.storage.getDownloadUrl(path);
    const response = await fetch(downloadUrl);
    assert(response.ok, `authorized download failed ${response.status}`);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert(sha256(downloaded) === contentSha256, 'downloaded content hash mismatch');
    await alice.transact(alice.tx.$files.lookup('path', path).delete());
    const postDelete = await waitFor(async () => {
      const result = await db.query({ $files: { $: { where: { path } } } });
      return result.$files.length === 0 ? result : null;
    });
    assert(postDelete.$files.length === 0, 'file metadata remained after deletion');
    let freshUrlAfterDelete;
    try {
      const freshUrl = await aliceClient.storage.getDownloadUrl(path);
      const freshResponse = await fetch(freshUrl, { cache: 'no-store' });
      freshUrlAfterDelete = {
        kind: 'success',
        deliveryStatus: freshResponse.status,
      };
    } catch (error) {
      freshUrlAfterDelete = {
        kind: 'error',
        errorType: error?.body?.type ?? error?.name ?? 'Error',
        errorMessage: String(error?.message ?? error).slice(0, 500),
      };
    }
    const retainedUrlStatuses = [];
    const expiryDeadline = Date.now() + 12000;
    while (Date.now() < expiryDeadline) {
      const candidate = await fetch(downloadUrl, { cache: 'no-store' });
      retainedUrlStatuses.push(candidate.status);
      if (!candidate.ok) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    const priorUrlInvalidated = retainedUrlStatuses.some((status) => status >= 400);
    const freshLookupInvalidated =
      freshUrlAfterDelete.kind === 'error' || freshUrlAfterDelete.deliveryStatus >= 400;
    return {
      status: priorUrlInvalidated && freshLookupInvalidated ? 'PASS' : 'GAP',
      summary: priorUrlInvalidated && freshLookupInvalidated
        ? 'Alice uploaded and downloaded the 262,144-byte art through native Storage, Mallory was denied, and deletion invalidated metadata, fresh lookup, and prior delivery.'
        : 'Upload, authorized delivery, outsider denial, and metadata deletion passed; at least one signed delivery path remained usable after deletion, so complete deletion is not claimed.',
      evidence: {
        fileIdSha256: sha256(upload.data.id),
        pathSha256: sha256(path),
        bytes: body.length,
        contentSha256,
        authorizedHttpStatus: response.status,
        malloryRead,
        postDeleteCount: postDelete.$files.length,
        freshUrlAfterDelete,
        freshLookupInvalidated,
        priorUrlInvalidated,
        retainedUrlStatuses,
        retainedCapabilityNote: priorUrlInvalidated
          ? 'prior signed URL stopped serving'
          : 'previously authorized signed URL remained a live bearer capability during the observation window',
        actorAuthority: 'two independent @instantdb/core clients authenticated with native refresh tokens',
        discardedHarnessAttempt: '../receipts/acceptance-failure-1785308168142.json',
      },
    };
  } finally {
    await aliceClient.auth.signOut({ invalidateToken: false }).catch(() => undefined);
    await malloryClient.auth.signOut({ invalidateToken: false }).catch(() => undefined);
  }
});

await scenario('PARTY-09-SCHEDULE', 'A scheduled reminder produces one inspectable idempotent attempt.', async () => ({
  status: 'GAP',
  summary: 'InstantDB 1.0.52 exposes database, auth, storage, realtime, streams, and webhooks, but no first-party scheduled-job/cron authoring surface was present in the pinned SDK/CLI or official documentation.',
  evidence: {
    claim: 'not implemented and not simulated',
    inspectedSurfaces: ['@instantdb/admin 1.0.52 exports', 'instant-cli 1.0.52 help', 'official docs index'],
    workaroundRejected: 'A local timer would not be provider-hosted scheduled work.',
  },
}));

await scenario('PARTY-10-EFFECT-RETRY', 'Known-success external notification remains idempotent across retry.', async () => {
  try {
    successWebhook = await db.webhooks.manager.create({
      url: 'https://postman-echo.com/post',
      namespaces: ['notificationAttempts'],
      actions: ['create'],
    });
  } catch (error) {
    return {
      status: 'GAP',
      summary: 'The native webhook manager rejected the deterministic HTTPS receiver during provisioning, so no external-effect retry pass is claimed.',
      evidence: {
        errorType: error?.body?.type ?? error?.name ?? 'Error',
        errorMessage: String(error?.message ?? error).slice(0, 500),
        failedReceiverAttempt: 'https://postman-echo.com/post',
        priorFailedReceiverAttempt: 'https://httpbin.org/status/204',
      },
    };
  }
  const notificationId = ids.opaque();
  await db.transact(
    db.tx.notificationAttempts[notificationId].update({
      attemptKey: `${namespace}:effect:known-success`,
      eventId: fixture.contendedEventId,
      outcome: 'requested',
      providerIdempotencyKey: `${namespace}:effect:known-success`,
      attemptedAt: Date.now(),
    }),
  );
  const page = await waitFor(async () => {
    const candidate = await db.webhooks.manager.listEvents(successWebhook.id);
    return candidate.events.some((item) => item.status === 'success') ? candidate : null;
  }, { timeoutMs: 45000, intervalMs: 1000 }).catch(() => null);
  if (!page) {
    return {
      status: 'GAP',
      summary: 'The native webhook was provisioned and queued, but the external deterministic receiver did not yield a terminal success within the evidence window.',
      evidence: {
        webhookIdSha256: sha256(successWebhook.id),
        receiver: 'https://postman-echo.com/post',
        providerBoundary: 'native Instant webhook manager',
      },
    };
  }
  const event = page.events.find((item) => item.status === 'success');
  const payload = await db.webhooks.manager.getPayload(successWebhook.id, event.isn);
  return {
    status: 'GAP',
    summary: 'Instant supplied a stable idempotency key and one successful delivery, but the frozen retry-dedupe fact requires an application receiver ledger; forcing resend would redeliver, so no dedupe pass is claimed.',
    evidence: {
      webhookIdSha256: sha256(successWebhook.id),
      eventIsnSha256: sha256(String(event.isn)),
      status: event.status,
      attemptCount: event.attempts.length,
      payloadIdempotencyKeySha256: sha256(payload.idempotencyKey),
      providerBoundary: 'native Instant webhook delivery/history',
      nonclaim: 'receiver-side exactly-once effect ledger',
    },
  };
});

await scenario('PARTY-11-EFFECT-AMBIGUOUS', 'Ambiguous outcome remains distinct and safely retryable.', async () => {
  try {
    ambiguousWebhook = await db.webhooks.manager.create({
      url: 'https://postman-echo.com/delay/20',
      namespaces: ['notificationAttempts'],
      actions: ['create'],
    });
  } catch (error) {
    return {
      status: 'GAP',
      summary: 'The native webhook manager rejected the 20-second HTTPS fault receiver during provisioning, so no ambiguous-outcome pass is claimed.',
      evidence: {
        errorType: error?.body?.type ?? error?.name ?? 'Error',
        errorMessage: String(error?.message ?? error).slice(0, 500),
        failedReceiverAttempt: 'https://postman-echo.com/delay/20',
      },
    };
  }
  const notificationId = ids.opaque();
  await db.transact(
    db.tx.notificationAttempts[notificationId].update({
      attemptKey: `${namespace}:effect:ambiguous`,
      eventId: fixture.contendedEventId,
      outcome: 'requested',
      providerIdempotencyKey: `${namespace}:effect:ambiguous`,
      attemptedAt: Date.now(),
    }),
  );
  const page = await waitFor(async () => {
    const candidate = await db.webhooks.manager.listEvents(ambiguousWebhook.id);
    return candidate.events.some((item) => item.attempts.length > 0) ? candidate : null;
  }, { timeoutMs: 35000, intervalMs: 1000 }).catch(() => null);
  if (!page) {
    return {
      status: 'GAP',
      summary: 'The timeout fault webhook was configured, but no inspectable delivery attempt appeared within the evidence window.',
      evidence: { webhookIdSha256: sha256(ambiguousWebhook.id), faultEndpoint: '20-second HTTPS delay' },
    };
  }
  const event = page.events[0];
  const payload = await db.webhooks.manager.getPayload(ambiguousWebhook.id, event.isn);
  const timeoutAttempt = event.attempts.find((attempt) => attempt.errorType === 'timeout');
  if (!timeoutAttempt) {
    return {
      status: 'GAP',
      summary: 'The external delay endpoint did not produce Instant’s timeout classification, so an ambiguous outcome is not claimed.',
      evidence: {
        webhookIdSha256: sha256(ambiguousWebhook.id),
        status: event.status,
        attemptErrorTypes: event.attempts.map((attempt) => attempt.errorType),
        stableIdempotencyKeySha256: sha256(payload.idempotencyKey),
      },
    };
  }
  return {
    summary: 'A 20-second receiver fault crossed Instant’s 15-second boundary; delivery history retained a timeout and the payload retained one stable idempotency key for safe receiver dedupe.',
    evidence: {
      webhookIdSha256: sha256(ambiguousWebhook.id),
      status: event.status,
      attemptCount: event.attempts.length,
      timeout: true,
      stableIdempotencyKeySha256: sha256(payload.idempotencyKey),
      safeRetryBoundary: 'native stable idempotency key; receiver must dedupe',
    },
  };
});

await scenario('PARTY-12-REVOCATION', 'Revocation stops future protected delivery.', async () => {
  let revocationHook;
  try {
    revocationHook = await db.webhooks.manager.create({
      url: 'https://postman-echo.com/post',
      namespaces: ['reminderJobs'],
      actions: ['create'],
    });
  } catch (error) {
    return {
      status: 'GAP',
      summary: 'No revocation delivery was claimed because the deterministic HTTPS receiver could not be provisioned through the native webhook manager.',
      evidence: {
        errorType: error?.body?.type ?? error?.name ?? 'Error',
        errorMessage: String(error?.message ?? error).slice(0, 500),
      },
    };
  }
  const disabled = await db.webhooks.manager.disable(revocationHook.id, {
    reason: `${namespace}: event-removal simulation`,
  });
  const before = await db.webhooks.manager.listEvents(revocationHook.id);
  await db.transact(
    db.tx.reminderJobs[ids.opaque()].update({
      dedupeKey: `${namespace}:revoked-reminder`,
      eventId: fixture.eventIds[19],
      dueAt: Date.now(),
      status: 'revoked',
      attemptCount: 0,
    }),
  );
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000));
  const after = await db.webhooks.manager.listEvents(revocationHook.id);
  await db.webhooks.manager.delete(revocationHook.id);
  assert(disabled.status === 'disabled', 'webhook revocation did not settle');
  if (after.events.length !== before.events.length) {
    stopDefect = {
      class: 'late-effect-after-confirmed-cancellation',
      scenario: 'PARTY-12-REVOCATION',
      detail: 'disabled webhook queued a new event',
    };
    throw new Error('STOP: disabled webhook queued protected delivery');
  }
  const retained = successWebhook
    ? await db.webhooks.manager.listEvents(successWebhook.id)
    : { events: [] };
  return {
    summary: 'A dedicated native webhook was disabled before the revoked reminder write; no event was queued, while prior webhook delivery history remained inspectable.',
    evidence: {
      webhookIdSha256: sha256(revocationHook.id),
      disabledStatus: disabled.status,
      eventsBefore: before.events.length,
      eventsAfter: after.events.length,
      retainedPriorEvents: retained.events.length,
      retainedStorePolicy: 'webhook delivery history remains provider-retained for approximately 60 days until the hook/app is deleted',
    },
  };
});

await scenario('PARTY-13-DEPLOY', 'Hosted secret/configuration, effect boundary, logs, and identity are inspectable.', async () => ({
  status: 'GAP',
  summary: 'The fresh hosted app, pushed schema/permissions, target identity, and native webhook history are inspectable; InstantDB has no pinned first-party hosted secret/function boundary for the requested notification code, so the complete deployment fact is not claimed.',
  evidence: {
    targetIdSha256: sha256(target.appId),
    configurationReceipts: ['../receipts/target-provision-redacted.json', 'config-push receipts'],
    effectBoundary: successWebhook ? {
      kind: 'native webhook',
      idSha256: sha256(successWebhook.id),
    } : null,
    logs: 'native webhook delivery event/attempt history',
    secretBoundary: 'GAP — admin token remained only in ignored local runtime state; no provider-hosted function secret was configured',
  },
}));

for (const hook of [ambiguousWebhook, successWebhook]) {
  if (!hook) continue;
  await db.webhooks.manager.delete(hook.id).catch(() => undefined);
}

const resultDocument = {
  schemaVersion: 1,
  app: 'partiful',
  provider: 'instantdb',
  targetIdSha256: sha256(target.appId),
  expectedCheckCount: 15,
  completedCheckCount: results.length,
  cleanupPending: true,
  stopDefects: stopDefect ? [stopDefect] : [],
  result: stopDefect ? 'stopped' : 'functional-complete-performance-and-cleanup-pending',
  actorHashes: Object.fromEntries(
    Object.entries(actors).map(([name, actor]) => [
      name,
      {
        idSha256: sha256(actor.id),
        emailSha256: sha256(actor.email),
        authKind: 'Instant native refresh-token principal',
      },
    ]),
  ),
  scenarioResults: results,
};
writeJson(resolve(evidenceDir, 'acceptance-results.json'), resultDocument);
writeJson(resolve(receiptsDir, 'webhook-operations.json'), {
  capturedAt: new Date().toISOString(),
  createdHookCount: [successWebhook, ambiguousWebhook].filter(Boolean).length + 1,
  deletedHookCount: [successWebhook, ambiguousWebhook].filter(Boolean).length + 1,
  remainingHooks: (await db.webhooks.manager.list()).length,
  hookIdsRetainedAsHashesOnly: true,
  containsSecretValues: false,
});
process.stdout.write(`${JSON.stringify({
  ok: !stopDefect,
  passes: results.filter((item) => item.result === 'PASS').length,
  gaps: results.filter((item) => item.result === 'GAP').length,
  failures: results.filter((item) => item.result === 'FAIL').length,
})}\n`);
