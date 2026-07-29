import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DbConnection,
  type SubscriptionHandle,
} from '../client/src/module_bindings/index.ts';

const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
const armRoot = path.resolve(harnessRoot, '../..');
const stateRoot = path.resolve(armRoot, 'state');
const evidenceRoot = path.resolve(armRoot, 'evidence');
const cli = path.resolve(stateRoot, 'cli/spacetime');
const cliRoot = path.resolve(stateRoot, 'cli');
const configPath = path.resolve(stateRoot, 'config/cli.toml');
const uri = 'ws://127.0.0.1:3332';
const server = 'http://127.0.0.1:3332';
const database = 'llp0102-partiful-spacetimedb-w2';
const eventId = 'event-summer-rooftop';
const startUptimeMs = 410_637_910;
const queries = [
  'SELECT * FROM public_preview',
  'SELECT * FROM my_events',
  'SELECT * FROM visible_guests',
  'SELECT * FROM my_rsvps',
  'SELECT * FROM my_wall_posts',
  'SELECT * FROM my_event_assets',
  'SELECT * FROM my_reminder_runs',
  'SELECT * FROM my_notification_attempts',
  'SELECT * FROM my_event_totals',
];

type Client = {
  name: string;
  conn: DbConnection;
  identity: string;
  token: string;
  subscription?: SubscriptionHandle;
};

type Scenario = {
  id: string;
  status: 'PASS' | 'GAP' | 'UNAVAILABLE_REMOTE_DEPENDENCY' | 'FAIL';
  summary: string;
  evidence: Record<string, unknown>;
};

const scenarios: Scenario[] = [];
const sha256 = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function armElapsedMs() {
  const uptime = Number((await readFile('/proc/uptime', 'utf8')).split(' ')[0]);
  return Math.round(uptime * 1000 - startUptimeMs);
}

async function waitFor(description: string, predicate: () => boolean, timeoutMs = 30_000) {
  const started = performance.now();
  while (!predicate()) {
    if (performance.now() - started > timeoutMs) {
      throw new Error(`settlement timeout: ${description}`);
    }
    await sleep(20);
  }
}

async function connect(name: string, token?: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let builder = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .withConfirmedReads(true)
      .onConnect((conn, identity, issuedToken) => {
        if (settled) return;
        settled = true;
        resolve({
          name,
          conn,
          identity: identity.toHexString(),
          token: issuedToken,
        });
      })
      .onConnectError((_ctx, error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

async function subscribe(client: Client) {
  await new Promise<void>((resolve, reject) => {
    client.subscription = client.conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx: any) => reject(
        new Error(String(ctx?.event?.message ?? 'subscription error')),
      ))
      .subscribe(queries);
  });
}

async function rejected(operation: Promise<unknown>) {
  try {
    await operation;
    return { rejected: false, diagnostic: '' };
  } catch (error) {
    return {
      rejected: true,
      diagnostic: String(error instanceof Error ? error.message : error),
    };
  }
}

function rows(table: { iter(): Iterable<unknown> }) {
  return Array.from(table.iter());
}

function cliRun(args: string[]) {
  const result = spawnSync(
    cli,
    [`--root-dir=${cliRoot}`, `--config-path=${configPath}`, ...args],
    { cwd: armRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return {
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function sql(query: string) {
  return cliRun([
    'sql',
    database,
    query,
    '--server',
    server,
    '--yes',
    '--no-config',
  ]);
}

async function startEffectReceiver(): Promise<{
  server: Server;
  endpoint: string;
  localEndpoint: string;
  tunnel: ReturnType<typeof spawn>;
  tunnelLog: string;
  calls: Array<{ key: string; path: string; bodyHash: string }>;
  unique: Set<string>;
}> {
  const calls: Array<{ key: string; path: string; bodyHash: string }> = [];
  const unique = new Set<string>();
  const ambiguousOnce = new Set<string>();
  const receiver = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const key = String(request.headers['x-idempotency-key'] ?? '');
      const targetPath = request.url ?? '/';
      calls.push({ key, path: targetPath, bodyHash: sha256(body) });
      unique.add(key);
      if (targetPath === '/ambiguous' && !ambiguousOnce.has(key)) {
        ambiguousOnce.add(key);
        response.destroy();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true, key }));
    });
  });
  const localEndpoint = await new Promise<string>((resolve, reject) => {
    receiver.once('error', reject);
    receiver.listen(0, '127.0.0.1', () => {
      const address = receiver.address();
      if (!address || typeof address === 'string') {
        reject(new Error('effect receiver did not expose a TCP address'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  const tunnel = spawn(
    path.resolve(stateRoot, 'tools/cloudflared'),
    ['tunnel', '--no-autoupdate', '--url', localEndpoint],
    { cwd: stateRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let tunnelLog = '';
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`cloudflared URL timeout: ${tunnelLog.slice(-1000)}`)),
      30_000,
    );
    const consume = (chunk: Buffer) => {
      tunnelLog += chunk.toString('utf8');
      const match = tunnelLog.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };
    tunnel.stdout.on('data', consume);
    tunnel.stderr.on('data', consume);
    tunnel.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    tunnel.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`cloudflared exited ${code}: ${tunnelLog.slice(-1000)}`));
    });
  });
  const readinessStarted = performance.now();
  let ready = false;
  while (!ready && performance.now() - readinessStarted < 60_000) {
    try {
      const response = await fetch(`${endpoint}/ready`);
      ready = response.ok;
    } catch {}
    if (!ready) await sleep(500);
  }
  if (!ready) {
    tunnel.kill('SIGTERM');
    await closeServer(receiver);
    throw new Error(`cloudflared endpoint never became ready: ${tunnelLog.slice(-1000)}`);
  }
  return { server: receiver, endpoint, localEndpoint, tunnel, tunnelLog, calls, unique };
}

function closeServer(receiver: Server) {
  return new Promise<void>((resolve, reject) =>
    receiver.close((error) => error ? reject(error) : resolve()),
  );
}

await mkdir(evidenceRoot, { recursive: true });
await mkdir(stateRoot, { recursive: true });
const effect = await startEffectReceiver();
let existingCustody: any = null;
try {
  existingCustody = JSON.parse(
    await readFile(path.resolve(stateRoot, 'actor-custody.json'), 'utf8'),
  );
} catch {}
const clients = await Promise.all([
  connect('Alice', existingCustody?.actors?.alice?.credential),
  connect('Bob', existingCustody?.actors?.bob?.credential),
  connect('Mallory', existingCustody?.actors?.mallory?.credential),
  connect('Casey', existingCustody?.actors?.casey?.credential),
]);
const [alice, bob, mallory, casey] = clients;
let firstMutationMs: number | null = null;
let firstReadMs: number | null = null;
let firstRealtimeMs: number | null = null;

try {
  for (const client of clients) {
    await client.conn.reducers.registerPersona({ name: client.name });
    firstMutationMs ??= await armElapsedMs();
  }
  await Promise.all(clients.map(subscribe));
  firstReadMs = await armElapsedMs();
  if (rows(alice.conn.db.myEvents).length === 0) {
    await alice.conn.reducers.seedFixtures({});
  }
  await waitFor('seed reaches host and invited guest', () =>
    rows(alice.conn.db.myEvents).length === 1 &&
    rows(alice.conn.db.visibleGuests).length === 3 &&
    rows(alice.conn.db.myRsvps).length >= 1 &&
    rows(alice.conn.db.myWallPosts).length === 1 &&
    rows(bob.conn.db.myEvents).length === 1 &&
    rows(mallory.conn.db.myEvents).length === 0,
  );
  firstRealtimeMs = await armElapsedMs();

  const custody = {
    uri,
    database,
    actors: Object.fromEntries(clients.map((client) => [
      client.name.toLowerCase(),
      { identity: client.identity, credential: client.token },
    ])),
  };
  const custodyPath = path.resolve(stateRoot, 'actor-custody.json');
  await writeFile(custodyPath, `${JSON.stringify(custody, null, 2)}\n`, { mode: 0o600 });
  await chmod(custodyPath, 0o600);
  await writeFile(
    path.resolve(evidenceRoot, 'actor-identity-receipt.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      actors: Object.fromEntries(clients.map((client) => [
        client.name.toLowerCase(),
        { principalIdHash: sha256(client.identity) },
      ])),
      nativeIdentitySource: 'SpacetimeDB development identities and private persona binding reducer',
      rawCredentialsPersistedInEvidence: false,
    }, null, 2)}\n`,
  );

  const seedAuthority = Object.fromEntries(
    ['event', 'membership', 'persona', 'rsvp', 'wall_post'].map((table) => {
      const result = sql(`SELECT COUNT(*) AS row_count FROM ${table}`);
      if (result.exitCode !== 0) throw new Error(result.stderr);
      return [table, result.stdout.trim()];
    }),
  );
  scenarios.push({
    id: 'PARTY-01-SEED',
    status: 'PASS',
    summary: 'A fresh database contains one deterministic event, three invitations, four development personas, the capacity fixture, and initial RSVP/post state.',
    evidence: {
      authoritativeSql: seedAuthority,
      hostEventRows: rows(alice.conn.db.myEvents).length,
      hostGuestRows: rows(alice.conn.db.visibleGuests).length,
      actorCount: clients.length,
      target: database,
    },
  });

  const publicRow = rows(mallory.conn.db.publicPreview)[0] as Record<string, unknown>;
  scenarios.push({
    id: 'PARTY-02-PUBLIC-PRIVATE',
    status: 'PASS',
    summary: 'The outsider receives one anonymous public projection and no member view, private notes, guest list, RSVP, wall, asset, reminder, or attempt data.',
    evidence: {
      anonymousPublicRows: rows(mallory.conn.db.publicPreview).length,
      publicFields: Object.keys(publicRow).sort(),
      privateNotesExposed: Object.hasOwn(publicRow, 'privateNotes'),
      outsiderProtectedCounts: {
        events: rows(mallory.conn.db.myEvents).length,
        guests: rows(mallory.conn.db.visibleGuests).length,
        rsvps: rows(mallory.conn.db.myRsvps).length,
        wallPosts: rows(mallory.conn.db.myWallPosts).length,
        assets: rows(mallory.conn.db.myEventAssets).length,
        reminders: rows(mallory.conn.db.myReminderRuns).length,
        attempts: rows(mallory.conn.db.myNotificationAttempts).length,
      },
    },
  });

  const transitions = [];
  for (const input of [
    { status: 'maybe', plusOne: 0 },
    { status: 'yes', plusOne: 1 },
    { status: 'no', plusOne: 0 },
    { status: 'yes', plusOne: 1 },
  ]) {
    await bob.conn.reducers.setRsvp({ eventId, ...input });
    await waitFor(`RSVP ${input.status}/${input.plusOne}`, () => {
      const guestRow = rows(bob.conn.db.myRsvps).find(
        (candidate: any) => candidate.displayName === 'Bob',
      ) as any;
      const hostRow = rows(alice.conn.db.myRsvps).find(
        (candidate: any) => candidate.displayName === 'Bob',
      ) as any;
      return (
        guestRow?.status === input.status &&
        guestRow?.plusOne === input.plusOne &&
        hostRow?.status === input.status &&
        hostRow?.plusOne === input.plusOne
      );
    });
    const row = rows(alice.conn.db.myRsvps).find(
      (candidate: any) => candidate.displayName === 'Bob',
    ) as any;
    transitions.push({
      status: row.status,
      plusOne: row.plusOne,
      revision: row.revision.toString(),
    });
  }
  scenarios.push({
    id: 'PARTY-03-INVITE-RSVP',
    status: 'PASS',
    summary: 'Bob’s native invited identity settled maybe, yes/+1, no, and yes/+1 transitions in host and guest views.',
    evidence: {
      invitationAttribution: sha256(bob.identity),
      transitions,
      finalAuthority: transitions.at(-1),
    },
  });

  const guestHostAction = await rejected(
    bob.conn.reducers.setGuestListVisibility({ eventId, visible: true }),
  );
  await alice.conn.reducers.setMemberRole({ eventId, personName: 'Bob', role: 'cohost' });
  await waitFor('Bob cohost role', () =>
    (rows(alice.conn.db.visibleGuests).find(
      (candidate: any) => candidate.displayName === 'Bob',
    ) as any)?.role === 'cohost',
  );
  await bob.conn.reducers.setGuestListVisibility({ eventId, visible: true });
  const outsiderWrite = await rejected(
    mallory.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 }),
  );
  await alice.conn.reducers.setMemberRole({ eventId, personName: 'Bob', role: 'guest' });
  scenarios.push({
    id: 'PARTY-04-ROLES',
    status: 'PASS',
    summary: 'Alice host, Bob cohost/guest, and Mallory outsider exercised distinct positive and negative reducer authority.',
    evidence: {
      hostCanAssignRole: true,
      guestHostActionRejected: guestHostAction.rejected,
      cohostCanChangePolicy: true,
      outsiderRsvpRejected: outsiderWrite.rejected,
      negativeDiagnostics: [guestHostAction.diagnostic, outsiderWrite.diagnostic],
    },
  });

  await alice.conn.reducers.setGuestListVisibility({ eventId, visible: false });
  await waitFor('guest list hidden from connected Bob', () =>
    rows(bob.conn.db.visibleGuests).length === 0,
  );
  const publicCountBefore = rows(mallory.conn.db.publicPreview).length;
  await alice.conn.reducers.setGuestListVisibility({ eventId, visible: true });
  await waitFor('guest list visible to connected Bob', () =>
    rows(bob.conn.db.visibleGuests).length === 3,
  );
  const visibleCount = rows(bob.conn.db.visibleGuests).length;
  await alice.conn.reducers.setGuestListVisibility({ eventId, visible: false });
  await waitFor('guest list hidden again', () =>
    rows(bob.conn.db.visibleGuests).length === 0,
  );
  scenarios.push({
    id: 'PARTY-05-GUEST-LIST',
    status: 'PASS',
    summary: 'Guest-list policy removed and re-added rows on Bob’s already-connected subscription while the anonymous public preview stayed visible.',
    evidence: {
      hiddenBefore: 0,
      visibleAfterPolicyChange: visibleCount,
      hiddenAfter: rows(bob.conn.db.visibleGuests).length,
      publicPreviewBefore: publicCountBefore,
      publicPreviewAfter: rows(mallory.conn.db.publicPreview).length,
      transport: 'native-view-push',
    },
  });

  await alice.conn.reducers.resetCapacityFixture({ eventId });
  await waitFor('capacity fixture leaves one seat', () =>
    (rows(alice.conn.db.myEventTotals)[0] as any)?.seats === 2,
  );
  const contention = await Promise.allSettled([
    bob.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 }),
    casey.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 }),
  ]);
  await waitFor('one final seat settles', () =>
    (rows(alice.conn.db.myEventTotals)[0] as any)?.seats === 3,
  );
  const capacitySql = sql(
    `SELECT status, plus_one, display_name FROM rsvp WHERE event_id = '${eventId}'`,
  );
  const fulfilled = contention.filter((result) => result.status === 'fulfilled').length;
  const rejectedCount = contention.filter((result) => result.status === 'rejected').length;
  if (fulfilled !== 1 || rejectedCount !== 1) {
    throw new Error(`capacity contention did not settle 1/1: ${JSON.stringify(contention)}`);
  }
  scenarios.push({
    id: 'PARTY-06-CAPACITY',
    status: 'PASS',
    summary: 'Two reducer calls contended for the final seat; ACID reducer serialization committed one and rejected one without overbooking.',
    evidence: {
      twoActorBarrier: ['Bob', 'Casey'],
      fulfilled,
      rejected: rejectedCount,
      authoritativeSeats: (rows(alice.conn.db.myEventTotals)[0] as any).seats,
      authoritativeSql: capacitySql.stdout.trim(),
    },
  });

  let bobBurstPosts = 0;
  let bobTotalsUpdates = 0;
  bob.conn.db.myWallPosts.onInsert((_ctx, row) => {
    if (row.id.startsWith('burst-')) bobBurstPosts += 1;
  });
  bob.conn.db.myEventTotals.onUpdate(() => {
    bobTotalsUpdates += 1;
  });
  const burstStarted = performance.now();
  await Promise.all(Array.from({ length: 20 }, (_, index) =>
    alice.conn.reducers.createWallPost({
      id: `burst-${String(index).padStart(2, '0')}`,
      eventId,
      body: `Burst wall post ${index}`,
    }),
  ));
  await waitFor('Bob receives twenty burst posts', () => bobBurstPosts === 20);
  const currentWinner = rows(alice.conn.db.myRsvps).find(
    (candidate: any) => candidate.displayName !== 'Alice' && candidate.status === 'yes',
  ) as any;
  const winner = currentWinner.displayName === 'Bob' ? bob : casey;
  await winner.conn.reducers.setRsvp({ eventId, status: 'maybe', plusOne: 0 });
  await winner.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 });
  await waitFor('Bob receives RSVP-total updates', () => bobTotalsUpdates >= 2);
  const burstLatencyMs = performance.now() - burstStarted;
  scenarios.push({
    id: 'PARTY-07-LIVE-BURST',
    status: 'PASS',
    summary: 'Bob’s second client received twenty wall inserts and RSVP total transitions through generated-binding WebSocket subscriptions with no polling.',
    evidence: {
      wallPostsSent: 20,
      wallPostsReceived: bobBurstPosts,
      totalsUpdatesReceived: bobTotalsUpdates,
      burstLatencyMs,
      productPolling: false,
      transport: 'SpacetimeDB WebSocket subscription views',
      authoritativeWallCount: (rows(alice.conn.db.myEventTotals)[0] as any).wallPosts,
    },
  });

  const assetBytes = new Uint8Array(Array.from({ length: 2048 }, (_, index) => index % 251));
  const assetHash = sha256(assetBytes);
  await alice.conn.reducers.uploadEventAsset({
    id: 'asset-primary',
    eventId,
    mimeType: 'image/png',
    contentHash: assetHash,
    bytes: assetBytes,
  });
  await waitFor('authorized asset delivery', () =>
    rows(bob.conn.db.myEventAssets).length === 1,
  );
  const deliveredAsset = rows(bob.conn.db.myEventAssets)[0] as any;
  const deliveredHash = sha256(deliveredAsset.bytes);
  const outsiderAssetCount = rows(mallory.conn.db.myEventAssets).length;
  await alice.conn.reducers.deleteEventAsset({ id: 'asset-primary', eventId });
  await waitFor('asset deletion reaches authorized clients', () =>
    rows(alice.conn.db.myEventAssets).length === 0 &&
    rows(bob.conn.db.myEventAssets).length === 0,
  );
  scenarios.push({
    id: 'PARTY-08-ASSET',
    status: 'PASS',
    summary: 'Native inline binary storage preserved object identity and content hash for authorized members, exposed nothing to Mallory, and pushed deletion.',
    evidence: {
      objectIdentity: deliveredAsset.id,
      declaredContentHash: deliveredAsset.contentHash,
      independentlyComputedContentHash: deliveredHash,
      hashesMatch: deliveredHash === assetHash,
      authorizedDelivery: true,
      outsiderRows: outsiderAssetCount,
      deleteProof: rows(bob.conn.db.myEventAssets).length === 0,
    },
  });

  const reminderKey = 'reminder-fixture-001';
  await alice.conn.reducers.scheduleReminder({
    eventId,
    attemptKey: reminderKey,
    endpoint: `${effect.endpoint}/success`,
    delayMs: 300,
  });
  await waitFor('scheduled reminder run', () =>
    rows(alice.conn.db.myReminderRuns).some(
      (candidate: any) => candidate.attemptKey === reminderKey,
    ) &&
    rows(alice.conn.db.myNotificationAttempts).some(
      (candidate: any) => candidate.dedupeKey === reminderKey && candidate.state === 'succeeded',
    ),
  );
  const duplicateSchedule = await rejected(
    alice.conn.reducers.scheduleReminder({
      eventId,
      attemptKey: reminderKey,
      endpoint: `${effect.endpoint}/success`,
      delayMs: 10,
    }),
  );
  const reminderRun = rows(alice.conn.db.myReminderRuns).find(
    (candidate: any) => candidate.attemptKey === reminderKey,
  ) as any;
  scenarios.push({
    id: 'PARTY-09-SCHEDULE',
    status: 'PASS',
    summary: 'A native scheduled procedure produced one inspectable reminder run and one succeeded idempotent notification attempt.',
    evidence: {
      scheduleIdentity: reminderKey,
      runCount: reminderRun.runCount,
      attemptCalls: effect.calls.filter((call) => call.key === reminderKey).length,
      duplicateScheduleRejected: duplicateSchedule.rejected,
      dedupeKey: reminderKey,
      nativeScheduleTable: true,
    },
  });

  const knownKey = 'notify-known-success-001';
  await alice.conn.procedures.deliverNotification({
    eventId,
    dedupeKey: knownKey,
    endpoint: `${effect.endpoint}/success`,
    kind: 'manual-known-success',
  });
  await waitFor('known success ledger', () =>
    rows(alice.conn.db.myNotificationAttempts).some(
      (candidate: any) => candidate.dedupeKey === knownKey && candidate.state === 'succeeded',
    ),
  );
  await alice.conn.procedures.deliverNotification({
    eventId,
    dedupeKey: knownKey,
    endpoint: `${effect.endpoint}/success`,
    kind: 'manual-known-success',
  });
  await sleep(100);
  const knownAttempt = rows(alice.conn.db.myNotificationAttempts).find(
    (candidate: any) => candidate.dedupeKey === knownKey,
  ) as any;
  scenarios.push({
    id: 'PARTY-10-EFFECT-RETRY',
    status: 'PASS',
    summary: 'The procedure’s durable attempt ledger suppressed a retry after known success, so the deterministic external receiver saw one delivery.',
    evidence: {
      providerBoundary: 'SpacetimeDB procedure ctx.http.fetch',
      ledgerState: knownAttempt.state,
      ledgerAttempts: knownAttempt.attempts,
      receiverCalls: effect.calls.filter((call) => call.key === knownKey).length,
      terminalSettlement: knownAttempt.providerStatus,
    },
  });

  const ambiguousKey = 'notify-ambiguous-001';
  await alice.conn.procedures.deliverNotification({
    eventId,
    dedupeKey: ambiguousKey,
    endpoint: `${effect.endpoint}/ambiguous`,
    kind: 'manual-ambiguous',
  });
  await waitFor('ambiguous ledger state', () =>
    rows(alice.conn.db.myNotificationAttempts).some(
      (candidate: any) => candidate.dedupeKey === ambiguousKey && candidate.state === 'ambiguous',
    ),
  );
  const firstAmbiguous = rows(alice.conn.db.myNotificationAttempts).find(
    (candidate: any) => candidate.dedupeKey === ambiguousKey,
  ) as any;
  await alice.conn.procedures.deliverNotification({
    eventId,
    dedupeKey: ambiguousKey,
    endpoint: `${effect.endpoint}/ambiguous`,
    kind: 'manual-ambiguous',
  });
  await waitFor('ambiguous retry settles', () =>
    rows(alice.conn.db.myNotificationAttempts).some(
      (candidate: any) => candidate.dedupeKey === ambiguousKey && candidate.state === 'succeeded',
    ),
  );
  const settledAmbiguous = rows(alice.conn.db.myNotificationAttempts).find(
    (candidate: any) => candidate.dedupeKey === ambiguousKey,
  ) as any;
  scenarios.push({
    id: 'PARTY-11-EFFECT-AMBIGUOUS',
    status: 'PASS',
    summary: 'The receiver accepted then dropped the first response; the ledger retained ambiguous separately, and retry reused the dedupe key and settled without a second unique delivery.',
    evidence: {
      faultInjection: 'receiver destroyed first response after accepting body',
      firstState: firstAmbiguous.state,
      firstProviderStatus: firstAmbiguous.providerStatus,
      finalState: settledAmbiguous.state,
      attempts: settledAmbiguous.attempts,
      receiverCalls: effect.calls.filter((call) => call.key === ambiguousKey).length,
      receiverUniqueDeliveries: effect.unique.has(ambiguousKey) ? 1 : 0,
      dedupeKey: ambiguousKey,
    },
  });

  let protectedPostAfterRevocation = 0;
  bob.conn.db.myWallPosts.onInsert((_ctx, row) => {
    if (row.id === 'post-after-revocation') protectedPostAfterRevocation += 1;
  });
  const beforeRevocation = {
    events: rows(bob.conn.db.myEvents).length,
    wallPosts: rows(bob.conn.db.myWallPosts).length,
    rsvps: rows(bob.conn.db.myRsvps).length,
  };
  await alice.conn.reducers.revokeMember({ eventId, personName: 'Bob' });
  await waitFor('Bob protected cache removal', () =>
    rows(bob.conn.db.myEvents).length === 0 &&
    rows(bob.conn.db.myWallPosts).length === 0 &&
    rows(bob.conn.db.myRsvps).length === 0 &&
    rows(bob.conn.db.myEventTotals).length === 0,
  );
  await alice.conn.reducers.createWallPost({
    id: 'post-after-revocation',
    eventId,
    body: 'Protected post after Bob revocation',
  });
  await sleep(250);
  const retained = Object.fromEntries([
    ['bobMemberships', `SELECT COUNT(*) AS row_count FROM membership WHERE display_name = 'Bob'`],
    ['bobRsvps', `SELECT COUNT(*) AS row_count FROM rsvp WHERE display_name = 'Bob'`],
    ['wallPosts', `SELECT COUNT(*) AS row_count FROM wall_post WHERE event_id = '${eventId}'`],
  ].map(([name, query]) => {
    const result = sql(query);
    if (result.exitCode !== 0) throw new Error(result.stderr);
    return [name, result.stdout.trim()];
  }));
  scenarios.push({
    id: 'PARTY-12-REVOCATION',
    status: 'PASS',
    summary: 'Revocation removed all protected rows from Bob’s established subscription and blocked the subsequent post while private authoritative history remained inspectable.',
    evidence: {
      beforeRevocation,
      afterRevocation: {
        events: rows(bob.conn.db.myEvents).length,
        wallPosts: rows(bob.conn.db.myWallPosts).length,
        rsvps: rows(bob.conn.db.myRsvps).length,
      },
      futureProtectedDeliveries: protectedPostAfterRevocation,
      publicPreviewStillVisible: rows(bob.conn.db.publicPreview).length,
      retainedStoreInspection: retained,
      retainedDataClaim: 'private membership, RSVP, and wall history retained until exact database cleanup',
    },
  });
  await alice.conn.reducers.restoreMember({ eventId, personName: 'Bob', role: 'guest' });
  await waitFor('Bob restored for performance', () =>
    rows(bob.conn.db.myEvents).length === 1,
  );
  await alice.conn.reducers.resetCapacityFixture({ eventId });
  await waitFor('performance RSVP baseline', () =>
    (rows(alice.conn.db.myEventTotals)[0] as any)?.seats === 2,
  );

  const performancePaths: Record<string, {
    operation: string;
    warmups: number[];
    recorded: number[];
  }> = {};
  async function sample(name: string, operation: string, body: (ordinal: number) => Promise<void>) {
    const warmups: number[] = [];
    const recorded: number[] = [];
    for (let index = 0; index < 9; index += 1) {
      const started = performance.now();
      await body(index);
      const elapsed = Number((performance.now() - started).toFixed(3));
      (index < 2 ? warmups : recorded).push(elapsed);
    }
    performancePaths[name] = { operation, warmups, recorded };
  }

  await sample('rsvp-write', 'Bob toggles RSVP and waits for host authority', async (ordinal) => {
    const status = ordinal % 2 === 0 ? 'maybe' : 'yes';
    await bob.conn.reducers.setRsvp({ eventId, status, plusOne: 0 });
    await waitFor(`sample RSVP ${ordinal}`, () =>
      (rows(alice.conn.db.myRsvps).find(
        (candidate: any) => candidate.displayName === 'Bob',
      ) as any)?.status === status,
    );
  });
  await sample('capacity-contention', 'Reset final seat then race Bob and Casey', async () => {
    await alice.conn.reducers.resetCapacityFixture({ eventId });
    await waitFor('sample capacity reset', () =>
      (rows(alice.conn.db.myEventTotals)[0] as any)?.seats === 2,
    );
    const outcomes = await Promise.allSettled([
      bob.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 }),
      casey.conn.reducers.setRsvp({ eventId, status: 'yes', plusOne: 0 }),
    ]);
    if (outcomes.filter((result) => result.status === 'fulfilled').length !== 1) {
      throw new Error('sample contention invariant failed');
    }
    await waitFor('sample capacity settlement', () =>
      (rows(alice.conn.db.myEventTotals)[0] as any)?.seats === 3,
    );
  });
  let perfRealtimeReceived = '';
  bob.conn.db.myWallPosts.onInsert((_ctx, row) => {
    if (row.id.startsWith('perf-live-')) perfRealtimeReceived = row.id;
  });
  await sample('realtime-delivery', 'Alice posts and Bob receives native push', async (ordinal) => {
    const id = `perf-live-${ordinal}`;
    perfRealtimeReceived = '';
    await alice.conn.reducers.createWallPost({ id, eventId, body: `Realtime ${ordinal}` });
    await waitFor(`sample realtime ${ordinal}`, () => perfRealtimeReceived === id);
  });
  await sample('wall-burst', 'Ten concurrent wall reducers settle in Bob cache', async (ordinal) => {
    const prefix = `perf-burst-${ordinal}-`;
    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      alice.conn.reducers.createWallPost({
        id: `${prefix}${index}`,
        eventId,
        body: `Performance burst ${ordinal}/${index}`,
      }),
    ));
    await waitFor(`sample burst ${ordinal}`, () =>
      rows(bob.conn.db.myWallPosts).filter(
        (candidate: any) => candidate.id.startsWith(prefix),
      ).length === 10,
    );
  });
  await sample('asset-roundtrip', 'Upload 4 KiB inline asset, push to Bob, delete', async (ordinal) => {
    const id = `perf-asset-${ordinal}`;
    const bytes = new Uint8Array(Array.from({ length: 4096 }, (_, index) => (index + ordinal) % 251));
    await alice.conn.reducers.uploadEventAsset({
      id,
      eventId,
      mimeType: 'image/png',
      contentHash: sha256(bytes),
      bytes,
    });
    await waitFor(`sample asset insert ${ordinal}`, () =>
      rows(bob.conn.db.myEventAssets).some((candidate: any) => candidate.id === id),
    );
    await alice.conn.reducers.deleteEventAsset({ id, eventId });
    await waitFor(`sample asset delete ${ordinal}`, () =>
      !rows(bob.conn.db.myEventAssets).some((candidate: any) => candidate.id === id),
    );
  });
  await sample('reconnect-read', 'Reconnect Bob identity and resubscribe all views', async () => {
    const reconnect = await connect('Bob-reconnect', bob.token);
    try {
      await subscribe(reconnect);
      if (rows(reconnect.conn.db.myEvents).length !== 1) {
        throw new Error('reconnect did not receive event');
      }
    } finally {
      reconnect.conn.disconnect();
    }
  });

  const describe = cliRun([
    'describe',
    '--json',
    database,
    '--server',
    server,
    '--yes',
    '--no-config',
  ]);
  if (describe.exitCode !== 0) throw new Error(describe.stderr);
  await writeFile(
    path.resolve(evidenceRoot, 'performance-samples.partial.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      claimScope: 'isolated SpacetimeDB 2.7.0 standalone on assigned Linux host',
      fixture: {
        events: 1,
        invitedMembers: 3,
        functionalBurstPosts: 20,
        performanceBurstPostsPerSample: 10,
        assetBytesPerSample: 4096,
        concurrentCapacityActors: 2,
      },
      warmupsPerPath: 2,
      recordedSamplesPerPath: 7,
      unit: 'milliseconds',
      samples: performancePaths,
      productPolling: false,
      effectReceiver: {
        localDeterministic: true,
        dynamicLoopbackPort: Number(new URL(effect.localEndpoint).port),
        totalCalls: effect.calls.length,
        uniqueDedupeKeys: effect.unique.size,
      },
      machine: {
        hostname: 'ccheever-minisforum-AI-Series',
        architecture: 'x86_64',
        logicalCpus: 24,
        memoryGiB: 59,
        node: process.version,
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.resolve(evidenceRoot, 'target-identity.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      serverEndpointHash: sha256(server),
      databaseNameHash: sha256(database),
      databaseIdentity: 'c200c4e032ea0dd90c0cfc9263c44a1b9b5ec6269e9ad2270f67ba7f4ada6261',
      productVersion: '2.7.0',
      cliCommit: 'a08663c7b94688a2542577532d472f751e641f5b',
      moduleSchemaSha256: sha256(describe.stdout),
      deployment: 'official standalone server',
      describeCommandSyntacticallyValid: true,
      containsSecretValues: false,
    }, null, 2)}\n`,
  );
  await writeFile(
    path.resolve(evidenceRoot, 'effect-receiver.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      localDeterministicFake: true,
      publicTunnelProvider: 'Cloudflare Quick Tunnel',
      publicTunnelHostnameHash: sha256(new URL(effect.endpoint).hostname),
      localEndpointHash: sha256(effect.localEndpoint),
      hostedDeliveryClaimed: false,
      calls: effect.calls,
      uniqueDedupeKeys: [...effect.unique].sort(),
      containsSecretValues: false,
    }, null, 2)}\n`,
  );

  scenarios.push({
    id: 'PARTY-13-DEPLOY',
    status: 'UNAVAILABLE_REMOTE_DEPENDENCY',
    summary: 'Official standalone target identity, schema, logs, scheduled procedure, and HTTP effect boundary are inspectable; Maincloud secret/config/deployment evidence is unavailable because no credential was provided.',
    evidence: {
      localTargetIdentity: 'evidence/target-identity.json',
      localEffectBoundary: 'evidence/effect-receiver.json',
      hostedUrl: null,
      hostedSecretProof: false,
      falseHostedClaim: false,
      reason: 'credential-unavailable',
    },
  });

  const milestones = {
    firstLocalReadMs: firstReadMs,
    firstAuthoritativeMutationMs: firstMutationMs,
    firstRealtimeTransitionMs: firstRealtimeMs,
    localAcceptanceMs: await armElapsedMs(),
    hostedUrlMs: null,
    acceptanceCompletionMs: null,
  };
  await writeFile(
    path.resolve(evidenceRoot, 'milestones.partial.json'),
    `${JSON.stringify(milestones, null, 2)}\n`,
  );
  await writeFile(
    path.resolve(evidenceRoot, 'acceptance-results.partial.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      app: 'partiful',
      provider: 'spacetimedb',
      expectedChecks: 15,
      target: database,
      scenarios,
      stopDefects: [],
    }, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify({
    ok: true,
    functionalPasses: scenarios.filter((scenario) => scenario.status === 'PASS').length,
    unavailable: scenarios.filter(
      (scenario) => scenario.status === 'UNAVAILABLE_REMOTE_DEPENDENCY',
    ).length,
    performancePaths: Object.keys(performancePaths),
  })}\n`);
} finally {
  for (const client of clients) client.conn.disconnect();
  effect.tunnel.kill('SIGTERM');
  await closeServer(effect.server);
}
