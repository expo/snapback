import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const execFileAsync = promisify(execFile);
const namespace = 'llp0102-partiful-convex-w2';
const eventKey = 'event-summer-rooftop';
const evidenceUrl = new URL('../evidence/performance.json', import.meta.url);
const config = JSON.parse(await readFile(new URL('../.convex/local/default/config.json', import.meta.url), 'utf8'));
const deploymentUrl = 'http://127.0.0.1:3336';
const warmups = 2;
const recordedSamples = 7;

type AdminAuthClient = {
  setAdminAuth(token: string, actingAsIdentity: { subject: string; issuer: string; name: string }): void;
};
type Sample = {
  ordinal: number;
  phase: 'warmup' | 'recorded';
  durationMs: number;
  result: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function identity(name: string) {
  return { subject: name.toLowerCase(), issuer: 'https://llp0102-partiful.local', name };
}
function httpActor(name: string) {
  const client = new ConvexHttpClient(deploymentUrl);
  (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
  return client;
}
function liveActor(name: string) {
  const client = new ConvexClient(deploymentUrl);
  (client as unknown as AdminAuthClient).setAdminAuth(config.adminKey, identity(name));
  return client;
}
function sha256(value: Uint8Array | string) {
  return createHash('sha256').update(value).digest('hex');
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}
async function waitFor<T>(
  inspect: () => T,
  ready: (value: T) => boolean,
  timeoutMs = 10_000,
) {
  const started = performance.now();
  do {
    const value = inspect();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (performance.now() - started < timeoutMs);
  throw new Error(`timed out after ${timeoutMs}ms`);
}
async function measurePath(name: string, run: (ordinal: number) => Promise<unknown>) {
  const samples: Sample[] = [];
  for (let ordinal = 0; ordinal < warmups + recordedSamples; ordinal += 1) {
    const started = performance.now();
    const result = await run(ordinal);
    samples.push({
      ordinal,
      phase: ordinal < warmups ? 'warmup' : 'recorded',
      durationMs: Number((performance.now() - started).toFixed(3)),
      result,
    });
  }
  const values = samples.filter((sample) => sample.phase === 'recorded').map((sample) => sample.durationMs);
  return {
    name,
    units: 'milliseconds',
    warmups,
    recordedSamples,
    raw: samples,
    median: median(values),
    nearestRankP95: p95(values),
  };
}

const alice = httpActor('Alice');
const bob = httpActor('Bob');
const casey = httpActor('Casey');
await alice.mutation(api.party.restoreMember, { namespace, eventKey, personName: 'Bob', role: 'cohost' });

const paths = [];
paths.push(await measurePath('representative-read', async () => {
  const state = await alice.query(api.party.privateState, { namespace, eventKey });
  assert(state, 'host state missing');
  return { events: 20, guestRows: state.guests.length, wallPosts: state.totals.wallPosts };
}));
paths.push(await measurePath('representative-write', async (ordinal) => {
  const visible = ordinal % 2 === 0;
  return alice.mutation(api.party.setGuestListVisibility, { namespace, eventKey, visible });
}));
paths.push(await measurePath('contention-final-seat', async () => {
  await alice.mutation(api.party.resetCapacityFixture, { namespace, eventKey });
  const settled = await Promise.allSettled([
    bob.mutation(api.party.setRsvp, { namespace, eventKey, status: 'yes', plusOne: 0 }),
    casey.mutation(api.party.setRsvp, { namespace, eventKey, status: 'yes', plusOne: 0 }),
  ]);
  const succeeded = settled.filter((value) => value.status === 'fulfilled').length;
  const rejected = settled.filter((value) => value.status === 'rejected').length;
  assert(succeeded === 1 && rejected === 1, 'contention invariant failed');
  return { simultaneousActors: 2, succeeded, rejected, occupiedSeats: 50 };
}));
paths.push(await measurePath('asset-upload-deliver-delete-262144b', async (ordinal) => {
  const bytes = Buffer.alloc(262_144, ordinal);
  const expectedHash = sha256(bytes);
  const assetKey = `perf-asset-${ordinal}`;
  const uploadUrl = await bob.mutation(api.party.generateEventUploadUrl, { namespace, eventKey });
  const upload = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  assert(upload.ok, `asset upload ${upload.status}`);
  const { storageId } = await upload.json() as { storageId: string };
  await bob.mutation(api.party.saveEventAsset, {
    namespace,
    eventKey,
    assetKey,
    storageId: storageId as never,
    mimeType: 'application/octet-stream',
    contentHash: expectedHash,
    byteLength: bytes.length,
  });
  const state = await alice.query(api.party.privateState, { namespace, eventKey });
  assert(state, 'asset state missing');
  const asset = state.assets.find((value: { assetKey: string }) => value.assetKey === assetKey);
  assert(asset?.url, 'asset URL missing');
  const delivered = new Uint8Array(await (await fetch(asset.url)).arrayBuffer());
  assert(sha256(delivered) === expectedHash, 'asset hash mismatch');
  await bob.mutation(api.party.deleteEventAsset, { namespace, eventKey, assetKey });
  return { bytes: bytes.length, hash: expectedHash, deleted: true };
}));
paths.push(await measurePath('realtime-delivery', async (ordinal) => {
  const client = liveActor('Alice');
  const observations: number[] = [];
  const unsubscribe = client.onUpdate(api.party.privateState, { namespace, eventKey }, (value) => {
    if (value) observations.push(value.totals.wallPosts);
  });
  await waitFor(() => observations, (values) => values.length > 0);
  const expected = observations.at(-1)! + 1;
  await bob.mutation(api.party.createWallPost, {
    namespace,
    eventKey,
    postKey: `perf-realtime-${ordinal}`,
    body: `Realtime sample ${ordinal}`,
  });
  await waitFor(() => observations, (values) => values.includes(expected));
  unsubscribe();
  await client.close();
  return { transport: 'Convex WebSocket subscription', observedCount: expected };
}));
paths.push(await measurePath('reconnect-first-reactive-value', async () => {
  const client = liveActor('Casey');
  let observed = false;
  const unsubscribe = client.onUpdate(api.party.publicPreview, { namespace }, (value) => {
    if (value?.eventKey === eventKey) observed = true;
  });
  await waitFor(() => observed, Boolean);
  unsubscribe();
  await client.close();
  return { transport: 'fresh Convex WebSocket client', publicEventObserved: observed };
}));
paths.push(await measurePath('build-or-deploy', async () => {
  const { stdout } = await execFileAsync('npm', ['run', 'build'], {
    cwd: process.cwd(),
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    operation: 'local production UI build plus TypeScript validation',
    hostedDeploy: false,
    outputSha256: sha256(stdout),
  };
}));

const report = {
  schemaVersion: 1,
  app: 'partiful',
  provider: 'convex',
  namespace,
  claimScope: 'small repeatable product workload; not production scale',
  measurement: {
    clock: 'performance.now monotonic wall duration',
    warmups,
    recordedSamples,
    statistics: ['raw', 'median', 'nearest-rank-p95'],
    environment: 'Minisforum Linux x86_64; fresh anonymous Convex local backend',
  },
  paths,
  costWindow: {
    boundary: 'fresh anonymous target provisioning through exact target cleanup',
    actualProviderUsage: 'No billed provider usage surfaced for anonymous local deployment.',
    actualProviderCostUsd: 0,
    hostComputeExcluded: true,
    listPriceEstimateUsd: null,
    reason: 'Hosted credentials were unavailable; a hosted list-price estimate would not describe the measured local target.',
    extrapolationCountsAsMeasured: false,
  },
};
await writeFile(evidenceUrl, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(paths.map((path) => ({
  name: path.name,
  median: path.median,
  p95: path.nearestRankP95,
}))));
