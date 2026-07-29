import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

// @ref LLP 0102#cross-application-acceptance-kernel — this untimed,
// fresh-target remediation adds the missing direct RSVP push evidence without
// rewriting the original PARTY-07 receipt or timed performance samples.
const namespace = 'llp0102-partiful-convex-w2-party07-remediation';
const eventKey = 'event-summer-rooftop';
const evidenceRoot = new URL('../evidence/', import.meta.url);
const configPath = new URL('../.convex/local/default/config.json', import.meta.url);

type AdminAuthClient = {
  setAdminAuth(
    token: string,
    identity: { subject: string; issuer: string; name: string },
  ): void;
};
type Observation = {
  receivedAt: string;
  elapsedFromSubscriptionMs: number;
  yes: number;
  seats: number;
  wallPosts: number;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function identity(name: string) {
  return {
    subject: name.toLowerCase(),
    issuer: 'https://llp0102-partiful-remediation.local',
    name,
  };
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
async function waitFor<T>(
  inspect: () => T,
  ready: (value: T) => boolean,
  timeoutMs = 10_000,
) {
  const started = performance.now();
  do {
    const current = inspect();
    if (ready(current)) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (performance.now() - started < timeoutMs);
  throw new Error(`timed out after ${timeoutMs}ms`);
}

const startedAt = new Date().toISOString();
const config = JSON.parse(await readFile(configPath, 'utf8'));
assert(
  config.ports?.cloud === 3356 && config.ports?.site === 3357,
  'remediation target port identity mismatch',
);
const deploymentUrl = 'http://127.0.0.1:3356';
const actor = (name: string) => {
  const client = new ConvexHttpClient(deploymentUrl);
  (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
  return client;
};
const liveActor = (name: string) => {
  const client = new ConvexClient(deploymentUrl);
  (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
  return client;
};
const alice = actor('Alice');
const bob = actor('Bob');
const casey = actor('Casey');
const mallory = actor('Mallory');
for (const [name, client] of [
  ['Alice', alice],
  ['Bob', bob],
  ['Casey', casey],
  ['Mallory', mallory],
] as const) {
  await client.mutation(api.party.registerPersona, { namespace, name });
}
const seed = await alice.mutation(api.party.seedFixtures, { namespace });
await alice.mutation(api.party.setRsvp, {
  namespace,
  eventKey,
  status: 'no',
  plusOne: 0,
});
const before = await alice.query(api.party.privateState, { namespace, eventKey });
assert(before, 'authoritative baseline state missing');
assert(
  before.totals.yes === 0 &&
  before.totals.seats === 0 &&
  before.totals.wallPosts === 1,
  `unexpected baseline ${JSON.stringify(before.totals)}`,
);

const clientA = liveActor('Alice');
const clientB = liveActor('Bob');
const subscribedAt = new Date().toISOString();
const subscribedMonotonic = performance.now();
const observationsA: Observation[] = [];
const observationsB: Observation[] = [];
const record = (target: Observation[]) => (value: typeof before | null) => {
  if (!value) return;
  target.push({
    receivedAt: new Date().toISOString(),
    elapsedFromSubscriptionMs: Number((performance.now() - subscribedMonotonic).toFixed(3)),
    yes: value.totals.yes,
    seats: value.totals.seats,
    wallPosts: value.totals.wallPosts,
  });
};
const unsubscribeA = clientA.onUpdate(
  api.party.privateState,
  { namespace, eventKey },
  record(observationsA),
);
const unsubscribeB = clientB.onUpdate(
  api.party.privateState,
  { namespace, eventKey },
  record(observationsB),
);
await waitFor(
  () => [observationsA, observationsB],
  ([first, second]) =>
    first.some((value) => value.yes === 0 && value.seats === 0 && value.wallPosts === 1) &&
    second.some((value) => value.yes === 0 && value.seats === 0 && value.wallPosts === 1),
);
const establishedBeforeWritesAt = new Date().toISOString();

const writeSettlements = await Promise.allSettled([
  ...Array.from({ length: 20 }, (_, index) =>
    bob.mutation(api.party.createWallPost, {
      namespace,
      eventKey,
      postKey: `remediation-burst-${String(index).padStart(2, '0')}`,
      body: `Remediation wall post ${index}`,
    })),
  bob.mutation(api.party.setRsvp, {
    namespace,
    eventKey,
    status: 'yes',
    plusOne: 0,
  }),
  casey.mutation(api.party.setRsvp, {
    namespace,
    eventKey,
    status: 'yes',
    plusOne: 0,
  }),
]);
assert(
  writeSettlements.every((result) => result.status === 'fulfilled'),
  'one or more remediation writes failed',
);
await waitFor(
  () => [observationsA, observationsB],
  ([first, second]) =>
    first.some((value) => value.yes === 2 && value.seats === 2 && value.wallPosts === 21) &&
    second.some((value) => value.yes === 2 && value.seats === 2 && value.wallPosts === 21),
);

const authoritative = await alice.query(api.party.privateState, { namespace, eventKey });
const authoritativeCounts = await alice.query(api.party.authoritativeCounts, { namespace });
assert(authoritative, 'authoritative final state missing');
assert(
  authoritative.totals.yes === 2 &&
  authoritative.totals.seats === 2 &&
  authoritative.totals.wallPosts === 21,
  `authoritative final totals mismatch ${JSON.stringify(authoritative.totals)}`,
);
assert(
  authoritativeCounts.wallPosts === 21 && authoritativeCounts.rsvps === 3,
  `authoritative row counts mismatch ${JSON.stringify(authoritativeCounts)}`,
);

unsubscribeA();
unsubscribeB();
await Promise.all([clientA.close(), clientB.close()]);
const targetIdentity = {
  profile: 'fresh anonymous local remediation target',
  deploymentName: config.deploymentName,
  backendVersion: config.backendVersion,
  namespace,
  ports: config.ports,
};
const receipt = {
  schemaVersion: 1,
  remediationId: 'PARTY-07-RSVP-WALL-NATIVE-PUSH-01',
  originalReceiptPreservedAt: 'evidence/scenarios/PARTY-07-LIVE-BURST.json',
  timedPerformanceRewritten: false,
  targetIdentity,
  targetIdentityHash: hash(JSON.stringify(targetIdentity)),
  startedAt,
  subscribedAt,
  establishedBeforeWritesAt,
  completedAt: new Date().toISOString(),
  fixture: {
    seed,
    baselineTotals: before.totals,
    requiredTransitions: {
      rsvpYes: [0, 2],
      occupiedSeats: [0, 2],
      addedWallPosts: 20,
      wallPosts: [1, 21],
    },
  },
  transport: {
    provider: 'Convex',
    attribution: 'two established ConvexClient WebSocket reactive-query subscriptions',
    polling: false,
    clientA: 'Alice',
    clientB: 'Bob',
  },
  writes: {
    count: writeSettlements.length,
    fulfilled: writeSettlements.filter((value) => value.status === 'fulfilled').length,
    rejected: writeSettlements.filter((value) => value.status === 'rejected').length,
  },
  clientAObservations: observationsA,
  clientBObservations: observationsB,
  authoritative: {
    totals: authoritative.totals,
    rowCounts: authoritativeCounts,
    rsvps: authoritative.rsvps.map((row) => ({
      displayName: row.displayName,
      status: row.status,
      plusOne: row.plusOne,
      revision: row.revision,
    })),
  },
  assertions: {
    bothClientsEstablishedBeforeWrites: true,
    bothClientsObservedBaseline: true,
    bothClientsObservedRsvpZeroToTwo: true,
    bothClientsObservedTwentyPostBurst: true,
    authoritativeTotalsAgree: true,
  },
};
await mkdir(evidenceRoot, { recursive: true });
await writeFile(
  new URL('remediation-party07-live-rsvp-and-wall.json', evidenceRoot),
  `${JSON.stringify(receipt, null, 2)}\n`,
);

const beforeCleanup = await alice.query(api.party.authoritativeCounts, { namespace });
const removed = await alice.mutation(api.party.cleanupNamespace, { namespace });
const afterCleanup = await alice.query(api.party.namespaceProbe, { namespace });
assert(
  Object.values(afterCleanup).every((value) => value === 0),
  `namespace cleanup failed ${JSON.stringify(afterCleanup)}`,
);
await writeFile(
  new URL('remediation-party07-cleanup.json', evidenceRoot),
  `${JSON.stringify({
    schemaVersion: 1,
    remediationId: receipt.remediationId,
    namespace,
    targetIdentityHash: receipt.targetIdentityHash,
    cleanupPlan: 'Delete only rows/storage indexed by the exact remediation namespace, then retire the exact fresh local target.',
    beforeCleanup,
    removed,
    namespaceNegativeProbe: afterCleanup,
    allZero: true,
    completedAt: new Date().toISOString(),
  }, null, 2)}\n`,
);
console.log(JSON.stringify({
  remediationId: receipt.remediationId,
  clientAFinal: observationsA.at(-1),
  clientBFinal: observationsB.at(-1),
  authoritative: receipt.authoritative,
  cleanupAllZero: true,
}));
