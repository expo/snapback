import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const LIVE_PHASE_TIMEOUT_MS = 15_000;
const env = readFileSync(join(import.meta.dirname, '..', '.env.local'), 'utf8');
const url = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1];
if (!url) throw new Error('VITE_CONVEX_URL missing; run CONVEX_AGENT_MODE=anonymous bunx convex dev');

const actor = new ConvexClient(url);
const observer = new ConvexClient(url);
let incidentId = null;
let off = null;
let readyTimeout = null;
let deliveryTimeout = null;
let primaryError = null;
try {
  await actor.mutation(api.incidents.seed, {});
  const first = await actor.query(api.incidents.list, {});
  if (first.length < 2) throw new Error('Convex seed is incomplete');

  const nonce = randomUUID();
  incidentId = await actor.mutation(api.incidents.create, {
    actorId: 'user_ada',
    title: `Bakeoff acceptance ${nonce}`,
    severity: 'SEV-2',
    now: Date.now(),
  });
  const witness = `Convex live witness ${nonce}`;
  let resolveReady;
  let rejectReady;
  const timing = {
    subscriptionStartedAt: new Date().toISOString(),
    subscribedAt: null,
    mutationStartedAt: null,
    mutationCompletedAt: null,
    deliveredAt: null,
  };
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  readyTimeout = setTimeout(
    () => rejectReady(new Error('Convex live subscription timed out')),
    LIVE_PHASE_TIMEOUT_MS,
  );
  let subscriptionReady = false;
  let subscriptionError = null;
  let resolveUpdate;
  let rejectUpdate;
  off = observer.onUpdate(
    api.incidents.comments,
    { incidentId },
    (rows) => {
      clearTimeout(readyTimeout);
      subscriptionReady = true;
      timing.subscribedAt ??= new Date().toISOString();
      resolveReady();
      if (resolveUpdate && rows.some((row) => row.body === witness)) {
        if (deliveryTimeout) clearTimeout(deliveryTimeout);
        timing.deliveredAt = new Date().toISOString();
        resolveUpdate(rows);
      }
    },
    (error) => {
      clearTimeout(readyTimeout);
      if (deliveryTimeout) clearTimeout(deliveryTimeout);
      if (!subscriptionReady) rejectReady(error);
      else if (rejectUpdate) rejectUpdate(error);
      else subscriptionError = error;
    },
  );
  await ready;
  const update = new Promise((resolve, reject) => {
    resolveUpdate = resolve;
    rejectUpdate = reject;
  });
  if (subscriptionError) rejectUpdate(subscriptionError);
  deliveryTimeout = setTimeout(
    () => rejectUpdate(new Error('Convex live update timed out')),
    LIVE_PHASE_TIMEOUT_MS,
  );
  timing.mutationStartedAt = new Date().toISOString();
  await actor.mutation(api.incidents.addComment, {
    actorId: 'user_ada',
    incidentId,
    body: witness,
    now: Date.now(),
  });
  timing.mutationCompletedAt = new Date().toISOString();
  await update;
  off();
  off = null;
  const brief = await actor.query(api.incidents.brief, { incidentId });
  if (!brief.includes('tasks complete')) throw new Error('Convex brief missing task summary');
  const search = await actor.query(api.incidents.search, { term: 'checkout' });
  if (!search.some((row) => row?.title === 'Checkout API latency')) {
    throw new Error('Convex search did not find checkout incident');
  }
  process.stdout.write(
    `Convex live witness: ${JSON.stringify(timing)}\n`,
  );
  process.stdout.write('Convex integration: seed, transaction, cross-client nonce-bound native live update, search, brief — pass\n');
} catch (error) {
  primaryError = error;
}

clearTimeout(readyTimeout);
clearTimeout(deliveryTimeout);
const cleanupErrors = [];
try {
  off?.();
} catch (error) {
  cleanupErrors.push(error);
}
if (incidentId) {
  try {
    await withTimeout(
      actor.mutation(api.incidents.deleteIncidentForAcceptance, {
        actorId: 'user_ada',
        incidentId,
      }),
      'Convex acceptance cleanup',
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
}
const closeResults = await Promise.allSettled([
  withTimeout(Promise.resolve().then(() => actor.close()), 'Convex actor close'),
  withTimeout(Promise.resolve().then(() => observer.close()), 'Convex observer close'),
]);
for (const result of closeResults) {
  if (result.status === 'rejected') cleanupErrors.push(result.reason);
}
if (primaryError || cleanupErrors.length > 0) {
  throw new AggregateError(
    [primaryError, ...cleanupErrors].filter(Boolean),
    primaryError
      ? `Convex integration failed${cleanupErrors.length > 0 ? ' and cleanup was incomplete' : ''}`
      : 'Convex cleanup was incomplete',
  );
}

async function withTimeout(promise, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          LIVE_PHASE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
