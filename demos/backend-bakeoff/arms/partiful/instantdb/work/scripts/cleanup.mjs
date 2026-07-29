import { createHash } from 'node:crypto';
// @ref LLP 0102#2026-07-28-target-access-amendment — all three fresh target attempts are identity-bound, exported, exact-cleaned, and probed without shared/account-wide deletion.
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { init } from '@instantdb/admin';
import {
  armRoot,
  namespace,
  receiptsDir,
  runtimeDir,
  sha256,
  workRoot,
  writeJson,
} from './lib.mjs';

const attempts = [
  {
    attempt: 1,
    namespace: 'llp0102-partiful-instantdb-w3',
    targetPath: resolve(runtimeDir, 'target-attempt1.json'),
    actorsPath: resolve(runtimeDir, 'actors-attempt1.json'),
  },
  {
    attempt: 2,
    namespace: 'llp0102-partiful-instantdb-w3-a2',
    targetPath: resolve(runtimeDir, 'target-attempt2.json'),
    actorsPath: resolve(runtimeDir, 'actors-attempt2.json'),
  },
  {
    attempt: 3,
    namespace,
    targetPath: resolve(runtimeDir, 'target.json'),
    actorsPath: resolve(runtimeDir, 'actors.json'),
  },
];
const entityNames = [
  'profiles',
  'events',
  'invitations',
  'seatClaims',
  'wallPosts',
  'reminderJobs',
  'notificationAttempts',
  '$files',
  '$users',
];
const deletionOrder = [
  '$files',
  'wallPosts',
  'seatClaims',
  'invitations',
  'reminderJobs',
  'notificationAttempts',
  'events',
  'profiles',
];

function rawDb(target) {
  return init({ appId: target.appId, adminToken: target.adminToken });
}

async function snapshot(db) {
  const query = Object.fromEntries(entityNames.map((name) => [name, {}]));
  const data = await db.query(query);
  const hooks = await db.webhooks.manager.list();
  return {
    data,
    hooks,
    counts: {
      ...Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]),
      ),
      webhooks: hooks.length,
    },
  };
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const plan = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  operation: 'exact cleanup of three fresh hosted temporary Instant apps created by this arm',
  targets: attempts.map((attempt) => {
    const target = JSON.parse(readFileSync(attempt.targetPath, 'utf8'));
    return {
      attempt: attempt.attempt,
      namespace: attempt.namespace,
      targetIdSha256: sha256(target.appId),
      credentialSource: `work/.arm-runtime/${attempt.targetPath.split('/').at(-1)}`,
      actions: [
        'hash authoritative app export',
        'delete every exact app webhook',
        `delete only rows/files/users in fresh target for ${attempt.namespace}`,
        'prove zero counts and invalid actor tokens',
      ],
    };
  }),
  forbiddenAndAbsent: [
    'account-wide deletion',
    'shared-target deletion',
    'wildcards or unresolved variables',
    'cleanup derived from CLI current default',
    'paths outside work/.arm-runtime and work/.env.local',
  ],
  unrelatedBaseline: 'not applicable: all three targets are fresh opaque temporary apps and no shared target is bound',
  providerShellLifecycle: 'empty temporary app shells and schema/permission configuration expire automatically after more than 24 hours',
};
writeJson(resolve(receiptsDir, 'cleanup-plan.json'), plan);

const cleanupReceipts = [];
for (const attempt of attempts) {
  const target = JSON.parse(readFileSync(attempt.targetPath, 'utf8'));
  const actors = JSON.parse(readFileSync(attempt.actorsPath, 'utf8'));
  const db = rawDb(target);
  const before = await snapshot(db);
  const exportManifest = {
    capturedAt: new Date().toISOString(),
    attempt: attempt.attempt,
    namespace: attempt.namespace,
    targetIdSha256: sha256(target.appId),
    counts: before.counts,
    canonicalDataSha256: stableHash(before.data),
    webhookConfigurationSha256: stableHash(before.hooks),
    containsRecordValues: false,
    note: 'Authoritative admin query and webhook-manager inventory were hashed before deletion; Instant temporary apps expose no separate snapshot API to this app-scoped token.',
  };
  writeJson(resolve(receiptsDir, `pre-cleanup-export-attempt${attempt.attempt}.json`), exportManifest);

  for (const hook of before.hooks) {
    await db.webhooks.manager.delete(hook.id);
  }
  for (const entity of deletionOrder) {
    const rows = before.data[entity] ?? [];
    if (rows.length) {
      await db.transact(rows.map((row) => db.tx[entity][row.id].delete()));
    }
  }
  for (const actor of Object.values(actors)) {
    await db.auth.deleteUser({ id: actor.id });
  }
  const after = await snapshot(db);
  if (Object.values(after.counts).some((count) => count !== 0)) {
    throw new Error(`cleanup incomplete for attempt ${attempt.attempt}: ${JSON.stringify(after.counts)}`);
  }
  const tokenInvalidation = {};
  for (const [name, actor] of Object.entries(actors)) {
    try {
      await db.auth.verifyToken(actor.token);
      tokenInvalidation[name] = false;
    } catch {
      tokenInvalidation[name] = true;
    }
  }
  if (Object.values(tokenInvalidation).some((invalidated) => !invalidated)) {
    throw new Error(`actor token remained valid for attempt ${attempt.attempt}`);
  }
  cleanupReceipts.push({
    attempt: attempt.attempt,
    namespace: attempt.namespace,
    targetIdSha256: sha256(target.appId),
    beforeCounts: before.counts,
    afterCounts: after.counts,
    actorTokensInvalidated: tokenInvalidation,
    exactTargetOnly: true,
    appShellStatus: 'empty; provider automatic expiry pending (>24 hours)',
    residualConfigurationUntilProviderExpiry: [
      'schema attributes and links',
      'permission rules',
      'opaque temporary app shell',
    ],
  });
}

const trackedAndEvidenceFiles = [];
function collect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.arm-runtime'].includes(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) collect(child);
    else trackedAndEvidenceFiles.push(child);
  }
}
collect(armRoot);
for (const attempt of attempts) {
  const target = JSON.parse(readFileSync(attempt.targetPath, 'utf8'));
  for (const path of trackedAndEvidenceFiles) {
    const content = readFileSync(path);
    if (content.includes(Buffer.from(target.adminToken))) {
      throw new Error(`secret token leaked into retained artifact ${path}`);
    }
  }
}

rmSync(runtimeDir, { recursive: true, force: true });
rmSync(resolve(workRoot, '.env.local'), { force: true });
const localRuntimeCredentialsRemoved = !existsSync(runtimeDir) && !existsSync(resolve(workRoot, '.env.local'));
if (!localRuntimeCredentialsRemoved) throw new Error('local runtime credential cleanup incomplete');

const finalReceipt = {
  schemaVersion: 1,
  startedAt: plan.capturedAt,
  finishedAt: new Date().toISOString(),
  operation: plan.operation,
  attempts: cleanupReceipts,
  unrelatedBaselinePreserved: true,
  unrelatedBaselineProof: 'fresh opaque targets only; no shared target/account resource selected or mutated',
  localRuntimeCredentialsRemoved,
  exactProcessPorts: {
    vite4337: 'stopped before cleanup',
    browserDebug9337: 'stopped before cleanup',
  },
  temporaryAppLifecycle: 'Each empty app shell is provider-scheduled for automatic deletion after more than 24 hours.',
  residualGap: 'App-scoped admin tokens cannot immediately delete the temporary app shell or remove its schema/permission configuration.',
  secretScan: {
    retainedArtifactCount: trackedAndEvidenceFiles.length,
    adminTokenMatches: 0,
  },
};
writeJson(resolve(receiptsDir, 'cleanup-final.json'), finalReceipt);
process.stdout.write(`${JSON.stringify({
  ok: true,
  attempts: cleanupReceipts.map((item) => ({
    attempt: item.attempt,
    targetIdSha256: item.targetIdSha256,
    afterCounts: item.afterCounts,
  })),
  localRuntimeCredentialsRemoved,
})}\n`);
