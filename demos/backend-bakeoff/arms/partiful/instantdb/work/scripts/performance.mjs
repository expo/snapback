import { spawnSync } from 'node:child_process';
// @ref LLP 0102#measurement-record — each representative path retains two warmups, seven raw samples, median, and nearest-rank p95 without production-scale extrapolation.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  actorEmail,
  dbForTarget,
  evidenceDir,
  ids,
  namespace,
  readTarget,
  runtimeDir,
  sha256,
  waitFor,
  workRoot,
  writeJson,
} from './lib.mjs';

const target = readTarget();
const db = dbForTarget(target);
const actors = JSON.parse(readFileSync(resolve(runtimeDir, 'actors.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(resolve(runtimeDir, 'fixture.json'), 'utf8'));
const alice = db.asUser({ email: actorEmail('alice') });
const bob = db.asUser({ email: actorEmail('bob') });
const assetBody = Buffer.alloc(262144, 0x5a);
const paths = {};
const failures = [];

function stats(samples) {
  const values = samples.filter((sample) => sample.phase === 'recorded').map((sample) => sample.durationMs);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    unit: 'ms',
    count: values.length,
    raw: values,
    median: sorted[Math.floor(sorted.length / 2)] ?? null,
    nearestRankP95: sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? null,
  };
}

async function collect(name, operation) {
  const samples = [];
  for (let index = 0; index < 9; index += 1) {
    const phase = index < 2 ? 'warmup' : 'recorded';
    const startedAt = new Date().toISOString();
    const begin = performance.now();
    try {
      const detail = await operation(index);
      samples.push({
        phase,
        sample: phase === 'warmup' ? index + 1 : index - 1,
        startedAt,
        durationMs: Number((performance.now() - begin).toFixed(3)),
        success: true,
        detail,
      });
    } catch (error) {
      const sample = {
        phase,
        sample: phase === 'warmup' ? index + 1 : index - 1,
        startedAt,
        durationMs: Number((performance.now() - begin).toFixed(3)),
        success: false,
        errorType: error?.body?.type ?? error?.name ?? 'Error',
        errorMessage: String(error?.message ?? error).slice(0, 500),
      };
      samples.push(sample);
      failures.push({ path: name, ...sample });
    }
    paths[name] = {
      warmups: samples.filter((sample) => sample.phase === 'warmup'),
      recorded: samples.filter((sample) => sample.phase === 'recorded'),
      statistics: stats(samples),
    };
    writeJson(resolve(evidenceDir, 'performance-partial.json'), {
      capturedAt: new Date().toISOString(),
      completedPaths: Object.keys(paths),
      paths,
      failures,
    });
  }
}

await collect('contention-final-seat', async () => {
  const aliceTx = alice.tx.seatClaims[fixture.finalSeatId]
    .update({ claimantId: actors.alice.id, occupied: true, claimedAt: Date.now() })
    .link({ claimant: actors.alice.id });
  const bobTx = bob.tx.seatClaims[fixture.finalSeatId]
    .update({ claimantId: actors.bob.id, occupied: true, claimedAt: Date.now() })
    .link({ claimant: actors.bob.id });
  const settlements = await Promise.allSettled([alice.transact(aliceTx), bob.transact(bobTx)]);
  const authoritative = await db.query({
    seatClaims: { $: { where: { eventId: fixture.contendedEventId } } },
  });
  const final = authoritative.seatClaims.find((claim) => claim.id === fixture.finalSeatId);
  const occupied = authoritative.seatClaims.filter((claim) => claim.occupied).length;
  if (!final?.occupied || occupied !== 50) throw new Error(`capacity settlement mismatch ${occupied}`);
  await db.transact(
    db.tx.seatClaims[fixture.finalSeatId]
      .update({ claimantId: 'unclaimed', occupied: false, claimedAt: Date.now() })
      .unlink({ claimant: final.claimantId }),
  );
  return {
    settlements: settlements.map((item) => item.status),
    authoritativeOccupied: occupied,
    winnerIdSha256: sha256(final.claimantId),
  };
});

await collect('burst-20-wall-posts', async (iteration) => {
  const postIds = Array.from({ length: 20 }, () => ids.opaque());
  const chunks = postIds.map((postId, index) =>
    alice.tx.wallPosts[postId]
      .update({
        nonce: `${namespace}:perf-burst:${iteration}:${index}`,
        eventId: fixture.contendedEventId,
        authorId: actors.alice.id,
        body: `Performance burst ${iteration}-${index}`,
        createdAt: Date.now() + index,
      })
      .link({ event: fixture.contendedEventId }),
  );
  await alice.transact(chunks);
  const authoritative = await db.query({
    wallPosts: { $: { where: { eventId: fixture.contendedEventId } } },
  });
  if (authoritative.wallPosts.length !== 20) throw new Error(`burst count ${authoritative.wallPosts.length}`);
  await db.transact(postIds.map((postId) => db.tx.wallPosts[postId].delete()));
  return { authoritativeCount: authoritative.wallPosts.length };
});

await collect('asset-262144-bytes', async (iteration) => {
  const path = `${namespace}/performance/${iteration}/asset.bin`;
  const upload = await db.storage.uploadFile(path, assetBody, {
    contentType: 'application/octet-stream',
  });
  const url = await db.storage.getDownloadUrl(path);
  const response = await fetch(url, { cache: 'no-store' });
  const bytes = (await response.arrayBuffer()).byteLength;
  if (!response.ok || bytes !== assetBody.length) throw new Error(`asset response ${response.status}/${bytes}`);
  await db.transact(db.tx.$files[upload.data.id].delete());
  return { bytes, fileIdSha256: sha256(upload.data.id) };
});

await collect('realtime-delivery', async (iteration) => {
  const postId = ids.opaque();
  const observations = [];
  const subscription = bob.subscribeQuery(
    { wallPosts: { $: { where: { eventId: fixture.contendedEventId } } } },
    (payload) => {
      if (payload.type === 'error') throw payload.error;
      observations.push({ at: performance.now(), count: payload.data.wallPosts.length });
    },
  );
  try {
    await waitFor(() => observations.some((item) => item.count === 0));
    const sentAt = performance.now();
    await alice.transact(
      alice.tx.wallPosts[postId]
        .update({
          nonce: `${namespace}:perf-live:${iteration}`,
          eventId: fixture.contendedEventId,
          authorId: actors.alice.id,
          body: `Realtime ${iteration}`,
          createdAt: Date.now(),
        })
        .link({ event: fixture.contendedEventId }),
    );
    const delivery = await waitFor(() => {
      const item = observations.find((candidate) => candidate.count === 1);
      return item && { latencyMs: Number((item.at - sentAt).toFixed(3)), count: item.count };
    });
    return delivery;
  } finally {
    subscription.close();
    await db.transact(db.tx.wallPosts[postId].delete()).catch(() => undefined);
  }
});

await collect('deploy-config-push', async () => {
  const begin = performance.now();
  const result = spawnSync(
    resolve(workRoot, 'node_modules/.bin/instant-cli'),
    ['push', 'all', '--app', target.appId, '--yes'],
    {
      cwd: workRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        XDG_CONFIG_HOME: resolve(runtimeDir, 'xdg/config'),
        XDG_CACHE_HOME: resolve(runtimeDir, 'xdg/cache'),
        XDG_DATA_HOME: resolve(runtimeDir, 'xdg/data'),
        XDG_STATE_HOME: resolve(runtimeDir, 'xdg/state'),
        INSTANT_CLI_AUTH_TOKEN: target.adminToken,
        INSTANT_APP_ADMIN_TOKEN: target.adminToken,
      },
    },
  );
  if (result.status !== 0) throw new Error(`config push exit ${result.status}`);
  return {
    providerCommandDurationMs: Number((performance.now() - begin).toFixed(3)),
    exitStatus: result.status,
    outputSha256: sha256(`${result.stdout}\n${result.stderr}`),
  };
});

const allRecordedComplete = Object.values(paths).every(
  (path) => path.recorded.length === 7 && path.recorded.every((sample) => sample.success),
);
const document = {
  schemaVersion: 1,
  app: 'partiful',
  provider: 'instantdb',
  targetIdSha256: sha256(target.appId),
  claimScope: 'small repeatable product workload; not production scale',
  warmupsPerPath: 2,
  recordedSamplesPerPath: 7,
  paths,
  failures,
  costWindow: {
    startedAt: '2026-07-29T06:32:56.448Z',
    measuredProviderUsage: 'Provider temporary-app dashboard usage telemetry was not exposed to this anonymous arm.',
    listPriceEstimate: '$0 for the documented temporary app during its >24-hour automatic lifecycle; no extrapolation is reported as measured.',
    extrapolationCountsAsMeasured: false,
  },
  result: allRecordedComplete ? 'complete' : 'partial',
};
writeJson(resolve(evidenceDir, 'performance.json'), document);
process.stdout.write(`${JSON.stringify({ ok: allRecordedComplete, paths: Object.keys(paths), failures: failures.length })}\n`);
