import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const namespace = 'llp0102-partiful-convex-w2';
const eventKey = 'event-summer-rooftop';
const evidenceRoot = new URL('../evidence/', import.meta.url);
const scenarioRoot = new URL('../evidence/scenarios/', import.meta.url);
const configPath = new URL('../.convex/local/default/config.json', import.meta.url);
const envPath = new URL('../.env.local', import.meta.url);

type ScenarioStatus = 'PASS' | 'FAIL' | 'GAP';
type ScenarioResult = {
  id: string;
  status: ScenarioStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  evidence: unknown;
  error?: string;
};
type AdminAuthClient = {
  setAdminAuth(token: string, actingAsIdentity: ReturnType<typeof identity>): void;
};
type EffectResult = {
  suppressed: boolean;
  attempts: number;
  state?: 'succeeded' | 'failed' | 'ambiguous';
  providerStatus?: string;
};

const results: ScenarioResult[] = [];
const effectReceipts: Array<{
  dedupeKey: string;
  path: string;
  receivedAt: string;
  bodySha256: string;
}> = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJson(url: URL, value: unknown) {
  await mkdir(new URL('.', url), { recursive: true });
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}

function parseEnv(contents: string) {
  return Object.fromEntries(
    contents.split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

function identity(name: string) {
  return {
    subject: name.toLowerCase(),
    issuer: 'https://llp0102-partiful.local',
    name,
  };
}

async function scenario(
  id: string,
  run: () => Promise<unknown>,
  expectedStatus: ScenarioStatus = 'PASS',
) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let result: ScenarioResult;
  try {
    const evidence = await run();
    result = {
      id,
      status: expectedStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Number((performance.now() - started).toFixed(3)),
      evidence,
    };
  } catch (error) {
    result = {
      id,
      status: 'FAIL',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Number((performance.now() - started).toFixed(3)),
      evidence: null,
      error: String(error),
    };
  }
  results.push(result);
  await writeJson(new URL(`${id}.json`, scenarioRoot), result);
  await writeJson(new URL('acceptance-results.partial.json', evidenceRoot), {
    schemaVersion: 1,
    namespace,
    expectedCheckCount: 15,
    completedCheckCount: results.length,
    results,
  });
  if (result.status === 'FAIL') throw new Error(`${id}: ${result.error}`);
  return result;
}

async function expectError(run: () => Promise<unknown>, code: string) {
  try {
    await run();
  } catch (error) {
    const message = String(error);
    assert(message.includes(code), `expected ${code}, got ${message}`);
    return { rejected: true, code };
  }
  throw new Error(`expected rejection ${code}`);
}

async function waitFor<T>(
  inspect: () => Promise<T>,
  ready: (value: T) => boolean,
  timeoutMs = 10_000,
) {
  const started = performance.now();
  let latest: T;
  do {
    latest = await inspect();
    if (ready(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() - started < timeoutMs);
  throw new Error(`timed out after ${timeoutMs}ms; latest=${JSON.stringify(latest!)}`);
}

async function startEffectSink() {
  const server: Server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    let dedupeKey = String(request.headers['x-idempotency-key'] ?? '');
    try {
      const parsed = JSON.parse(body.toString('utf8'));
      dedupeKey ||= String(parsed.dedupeKey ?? '');
    } catch {
      // The body hash still makes a malformed request inspectable.
    }
    effectReceipts.push({
      dedupeKey,
      path: request.url ?? '/',
      receivedAt: new Date().toISOString(),
      bodySha256: sha256(body),
    });
    if (request.url === '/ambiguous') {
      request.socket.destroy();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"accepted":true}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'effect sink address unavailable');
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(scenarioRoot, { recursive: true });
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const env = parseEnv(await readFile(envPath, 'utf8'));
  const deploymentUrl = env.VITE_CONVEX_URL;
  assert(deploymentUrl === 'http://127.0.0.1:3336', `unexpected target ${deploymentUrl}`);
  assert(config.ports?.cloud === 3336 && config.ports?.site === 3337, 'port identity mismatch');
  assert(config.deploymentName === 'anonymous-agent', 'anonymous local target mismatch');

  function httpActor(name?: string) {
    const client = new ConvexHttpClient(deploymentUrl);
    if (name) (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
    return client;
  }
  function liveActor(name?: string) {
    const client = new ConvexClient(deploymentUrl);
    if (name) (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
    return client;
  }

  const anonymous = httpActor();
  const alice = httpActor('Alice');
  const bob = httpActor('Bob');
  const casey = httpActor('Casey');
  const mallory = httpActor('Mallory');
  for (const [name, client] of [
    ['Alice', alice],
    ['Bob', bob],
    ['Casey', casey],
    ['Mallory', mallory],
  ] as const) {
    await client.mutation(api.party.registerPersona, { namespace, name });
  }

  await scenario('PARTY-01-SEED', async () => {
    const receipt = await alice.mutation(api.party.seedFixtures, { namespace });
    const counts = await alice.query(api.party.authoritativeCounts, { namespace });
    assert(receipt.events === 20 && receipt.guests === 49 && receipt.capacity === 50, 'seed receipt mismatch');
    assert(counts.personas === 4 && counts.events === 20, 'fixture count mismatch');
    assert(counts.memberships === 50 && counts.rsvps === 1 && counts.wallPosts === 1, 'primary event fixture mismatch');
    return {
      targetIdentity: {
        kind: 'fresh-anonymous-local',
        namespace,
        deploymentName: config.deploymentName,
        cloudPort: config.ports.cloud,
        sitePort: config.ports.site,
        backendVersion: config.backendVersion,
      },
      seedReceipt: receipt,
      authoritativeCounts: counts,
    };
  });

  await scenario('PARTY-02-PUBLIC-PRIVATE', async () => {
    const preview = await anonymous.query(api.party.publicPreview, { namespace });
    const privateAnonymous = await anonymous.query(api.party.privateState, { namespace, eventKey });
    const privateAlice = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(preview?.title === 'Summer Rooftop Supper', 'public preview missing');
    assert(!('privateNotes' in preview), 'private field leaked publicly');
    assert(privateAnonymous === null, 'anonymous private read was not denied');
    assert(privateAlice?.event.privateNotes.includes('0427'), 'host private state missing');
    return {
      anonymousRead: preview,
      publicFields: Object.keys(preview).sort(),
      privateAnonymous,
      hostPrivateFieldPresent: Boolean(privateAlice!.event.privateNotes),
    };
  });

  await scenario('PARTY-03-INVITE-RSVP', async () => {
    const transitions = [];
    transitions.push(await bob.mutation(api.party.setRsvp, { namespace, eventKey, status: 'maybe', plusOne: 1 }));
    transitions.push(await bob.mutation(api.party.setRsvp, { namespace, eventKey, status: 'no', plusOne: 0 }));
    transitions.push(await bob.mutation(api.party.setRsvp, { namespace, eventKey, status: 'yes', plusOne: 1 }));
    const state = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(state, 'host state missing');
    const settled = state.rsvps.find((row: { displayName: string }) => row.displayName === 'Bob');
    assert(settled?.status === 'yes' && settled.plusOne === 1 && settled.revision === 3, 'RSVP did not settle');
    return {
      invitationAttribution: state.guests.find((guest: { displayName: string }) => guest.displayName === 'Bob'),
      transitions,
      authoritativeState: settled,
    };
  });

  await scenario('PARTY-04-ROLES', async () => {
    await alice.mutation(api.party.setMemberRole, { namespace, eventKey, personName: 'Bob', role: 'cohost' });
    const cohostWrite = await bob.mutation(api.party.setGuestListVisibility, { namespace, eventKey, visible: false });
    const guestWrite = await expectError(
      () => casey.mutation(api.party.setGuestListVisibility, { namespace, eventKey, visible: true }),
      'PARTY_HOST_OR_COHOST_REQUIRED',
    );
    const outsiderWrite = await expectError(
      () => mallory.mutation(api.party.createWallPost, {
        namespace,
        eventKey,
        postKey: 'mallory-forbidden',
        body: 'should not land',
      }),
      'PARTY_MEMBER_REQUIRED',
    );
    const outsiderRead = await mallory.query(api.party.privateState, { namespace, eventKey });
    assert(outsiderRead === null, 'outsider received protected state');
    return {
      positiveRoleMatrix: { host: 'seed/role', cohost: cohostWrite, guest: 'rsvp/wall allowed' },
      negativeRoleMatrix: { guestWrite, outsiderWrite, outsiderRead },
    };
  });

  await scenario('PARTY-05-GUEST-LIST', async () => {
    await alice.mutation(api.party.setGuestListVisibility, { namespace, eventKey, visible: false });
    const connected = liveActor('Casey');
    const observations: Array<{ visible: boolean; guestCount: number }> = [];
    const unsubscribe = connected.onUpdate(
      api.party.privateState,
      { namespace, eventKey },
      (value) => {
        if (value) observations.push({
          visible: value.event.guestListVisible,
          guestCount: value.guests.length,
        });
      },
    );
    await waitFor(async () => observations, (values) => values.some((value) => !value.visible && value.guestCount === 0));
    await alice.mutation(api.party.setGuestListVisibility, { namespace, eventKey, visible: true });
    await waitFor(async () => observations, (values) => values.some((value) => value.visible && value.guestCount === 50));
    const preview = await anonymous.query(api.party.publicPreview, { namespace });
    unsubscribe();
    await connected.close();
    return {
      policyTransition: [false, true],
      actorSpecificReads: { guestCountAfterEnable: 50, publicStillVisible: Boolean(preview) },
      alreadyConnectedClient: observations,
      transport: 'Convex WebSocket reactive query',
    };
  });

  await scenario('PARTY-06-CAPACITY', async () => {
    const fixture = await alice.mutation(api.party.resetCapacityFixture, { namespace, eventKey });
    const barrierStartedAt = new Date().toISOString();
    const settled = await Promise.allSettled([
      bob.mutation(api.party.setRsvp, { namespace, eventKey, status: 'yes', plusOne: 0 }),
      casey.mutation(api.party.setRsvp, { namespace, eventKey, status: 'yes', plusOne: 0 }),
    ]);
    const successes = settled.filter((value) => value.status === 'fulfilled');
    const failures = settled.filter((value) => value.status === 'rejected');
    assert(successes.length === 1 && failures.length === 1, 'final seat was not serialized');
    assert(String((failures[0] as PromiseRejectedResult).reason).includes('PARTY_CAPACITY_EXCEEDED'), 'wrong contention rejection');
    const state = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(state, 'host state missing after contention');
    assert(state.totals.seats === 50, `capacity settled at ${state.totals.seats}`);
    return {
      twoActorBarrier: { barrierStartedAt, actors: ['Bob', 'Casey'], simultaneousAttempts: 2 },
      fixture,
      settlement: settled.map((value) =>
        value.status === 'fulfilled'
          ? { status: value.status, response: value.value }
          : { status: value.status, errorCode: 'PARTY_CAPACITY_EXCEEDED' }),
      authoritativeCount: { occupiedSeats: state.totals.seats, capacity: state.event.capacity },
    };
  });

  await scenario('PARTY-07-LIVE-BURST', async () => {
    const watcherA = liveActor('Alice');
    const watcherB = liveActor('Casey');
    const a: number[] = [];
    const b: number[] = [];
    const unsubA = watcherA.onUpdate(api.party.privateState, { namespace, eventKey }, (value) => {
      if (value) a.push(value.totals.wallPosts);
    });
    const unsubB = watcherB.onUpdate(api.party.privateState, { namespace, eventKey }, (value) => {
      if (value) b.push(value.totals.wallPosts);
    });
    await waitFor(async () => [a, b], ([first, second]) => first.length > 0 && second.length > 0);
    const baselineState = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(baselineState, 'host burst baseline missing');
    const baseline = baselineState.totals.wallPosts;
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      bob.mutation(api.party.createWallPost, {
        namespace,
        eventKey,
        postKey: `burst-${String(index).padStart(2, '0')}`,
        body: `Frozen wall burst ${index}`,
      })));
    await waitFor(async () => [a, b], ([first, second]) =>
      first.includes(baseline + 20) && second.includes(baseline + 20));
    const state = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(state, 'host burst state missing');
    unsubA();
    unsubB();
    await Promise.all([watcherA.close(), watcherB.close()]);
    return {
      secondClient: true,
      transportAttribution: 'two ConvexClient WebSocket subscriptions to the native privateState query',
      baseline,
      wallBurstPosts: 20,
      clientAObservations: a,
      clientBObservations: b,
      authoritativeCount: state.totals,
    };
  });

  await scenario('PARTY-08-ASSET', async () => {
    const bytes = Buffer.alloc(262_144);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    const contentHash = sha256(bytes);
    const uploadUrl = await bob.mutation(api.party.generateEventUploadUrl, { namespace, eventKey });
    const uploaded = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    });
    assert(uploaded.ok, `upload failed ${uploaded.status}`);
    const { storageId } = await uploaded.json() as { storageId: string };
    await bob.mutation(api.party.saveEventAsset, {
      namespace,
      eventKey,
      assetKey: 'hero-art',
      storageId: storageId as never,
      mimeType: 'application/octet-stream',
      contentHash,
      byteLength: bytes.length,
    });
    const state = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(state, 'host asset state missing');
    const asset = state.assets.find((candidate: { assetKey: string }) => candidate.assetKey === 'hero-art');
    assert(asset?.url, 'authorized asset URL missing');
    const delivered = new Uint8Array(await (await fetch(asset.url)).arrayBuffer());
    assert(sha256(delivered) === contentHash, 'delivered asset hash mismatch');
    const outsider = await expectError(
      () => mallory.mutation(api.party.generateEventUploadUrl, { namespace, eventKey }),
      'PARTY_MEMBER_REQUIRED',
    );
    await bob.mutation(api.party.deleteEventAsset, { namespace, eventKey, assetKey: 'hero-art' });
    const afterDelete = await fetch(asset.url);
    const stateAfterDelete = await alice.query(api.party.privateState, { namespace, eventKey });
    assert(stateAfterDelete, 'host state missing after asset delete');
    assert(!afterDelete.ok && stateAfterDelete.assets.length === 0, 'asset deletion not proven');
    return {
      objectIdentity: { storageIdSha256: sha256(storageId), assetKey: 'hero-art', byteLength: bytes.length },
      authorization: { cohostUpload: true, outsider },
      contentHash,
      deliveredHash: sha256(delivered),
      deleteProof: { priorUrlStatus: afterDelete.status, metadataRows: stateAfterDelete.assets.length },
    };
  });

  const sink = await startEffectSink();
  try {
    await scenario('PARTY-09-SCHEDULE', async () => {
      const receipt = await alice.mutation(api.party.scheduleReminder, {
        namespace,
        eventKey,
        attemptKey: 'scheduled-reminder-1',
        endpoint: `${sink.baseUrl}/success`,
        delayMs: 50,
      });
      const inspected = await waitFor(
        () => alice.query(api.party.inspectReminder, { namespace, eventKey, attemptKey: 'scheduled-reminder-1' }),
        (value) => value.reminder?.state === 'complete' && value.attempt?.state === 'succeeded',
      );
      const effects = effectReceipts.filter((value) => value.dedupeKey === 'scheduled-reminder-1');
      assert(effects.length === 1 && inspected.reminder?.runCount === 1, 'scheduled reminder did not run exactly once');
      return {
        scheduleIdentity: receipt,
        runReceipt: inspected,
        dedupeKey: 'scheduled-reminder-1',
        providerBoundaryReceipts: effects,
      };
    });

    await scenario('PARTY-10-EFFECT-RETRY', async () => {
      const args = {
        namespace,
        eventKey,
        dedupeKey: 'known-success-1',
        endpoint: `${sink.baseUrl}/success`,
        kind: 'invite-notification',
      };
      const first = await alice.action(api.party.deliverNotification, args) as EffectResult;
      const retry = await alice.action(api.party.deliverNotification, args) as EffectResult;
      const effects = effectReceipts.filter((value) => value.dedupeKey === args.dedupeKey);
      assert(first.state === 'succeeded' && retry.suppressed === true, 'known-success retry was not suppressed');
      assert(effects.length === 1, `known-success sent ${effects.length} effects`);
      return {
        attemptLedger: { first, retry },
        providerBoundary: effects,
        terminalSettlement: 'succeeded',
      };
    });

    await scenario('PARTY-11-EFFECT-AMBIGUOUS', async () => {
      const args = {
        namespace,
        eventKey,
        dedupeKey: 'ambiguous-1',
        endpoint: `${sink.baseUrl}/ambiguous`,
        kind: 'invite-notification',
      };
      const first = await alice.action(api.party.deliverNotification, args) as EffectResult;
      const retry = await alice.action(api.party.deliverNotification, args) as EffectResult;
      const effects = effectReceipts.filter((value) => value.dedupeKey === args.dedupeKey);
      assert(first.state === 'ambiguous' && retry.state === 'ambiguous', 'ambiguous state collapsed');
      assert(first.attempts === 1 && retry.attempts === 2, 'ambiguous retry ledger mismatch');
      return {
        faultInjection: 'sink accepted request body then destroyed socket before HTTP settlement',
        attemptLedger: { first, retry },
        ambiguousState: 'transport-outcome-unknown remains nonterminal and retryable',
        providerBoundaryReceipts: effects,
        duplicateRisk: 'retry can duplicate an effect that the provider accepted before disconnect',
      };
    });

    await scenario('PARTY-12-REVOCATION', async () => {
      await alice.mutation(api.party.setRsvp, { namespace, eventKey, status: 'maybe', plusOne: 0 });
      await bob.mutation(api.party.createWallPost, {
        namespace,
        eventKey,
        postKey: 'bob-before-revocation',
        body: 'This remains after membership revocation.',
      });
      const authorityChange = await alice.mutation(api.party.revokeMember, { namespace, eventKey, personName: 'Bob' });
      const protectedRead = await bob.query(api.party.privateState, { namespace, eventKey });
      const negativeDelivery = await expectError(
        () => bob.action(api.party.deliverNotification, {
          namespace,
          eventKey,
          dedupeKey: 'revoked-bob',
          endpoint: `${sink.baseUrl}/success`,
          kind: 'revocation-check',
        }),
        'PARTY_HOST_OR_COHOST_REQUIRED',
      );
      const retained = await alice.query(api.party.retainedCounts, { namespace, eventKey, personName: 'Bob' });
      assert(protectedRead === null && retained.memberships === 1 && retained.activeMemberships === 0, 'revocation boundary mismatch');
      assert(retained.rsvps === 1, 'RSVP was not honestly retained');
      return {
        authorityChange,
        protectedRead,
        negativeDelivery,
        retainedStoreInspection: retained,
        retentionPolicy: 'membership and RSVP retained until namespace cleanup; protected delivery denied immediately',
      };
    });
  } finally {
    await new Promise<void>((resolve) => sink.server.close(() => resolve()));
  }

  await scenario('PARTY-13-DEPLOY', async () => ({
    reasonCode: 'UNAVAILABLE_REMOTE_DEPENDENCY',
    reason: 'The supplied CONVEX_DEPLOY_KEY is empty; no hosted mutation or deployment was attempted.',
    localDeploymentReceipt: {
      deploymentName: config.deploymentName,
      backendVersion: config.backendVersion,
      cloudPort: config.ports.cloud,
      sitePort: config.ports.site,
    },
    redactedConfigProof: {
      envKeys: Object.keys(env).sort(),
      configKeys: Object.keys(config).sort(),
      secretValuesRetained: false,
    },
    effectReceiptCount: effectReceipts.length,
  }), 'GAP');

  await writeJson(new URL('effect-receipts.json', evidenceRoot), {
    schemaVersion: 1,
    sink: 'arm-local ephemeral HTTP receiver',
    receipts: effectReceipts,
  });
  await writeJson(new URL('acceptance-results.json', evidenceRoot), {
    schemaVersion: 1,
    namespace,
    expectedCheckCount: 15,
    completedCheckCount: results.length,
    pending: ['PARTY-14-PERFORMANCE', 'PARTY-15-CLEANUP'],
    results,
  });
  console.log(JSON.stringify({
    completed: results.length,
    pass: results.filter((value) => value.status === 'PASS').length,
    gap: results.filter((value) => value.status === 'GAP').length,
    fail: results.filter((value) => value.status === 'FAIL').length,
  }));
}

await main();
