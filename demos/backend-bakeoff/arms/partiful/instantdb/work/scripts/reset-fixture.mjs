import { resolve } from 'node:path';
import { actorEmail, dbForTarget, queryCounts, receiptsDir, sha256, writeJson } from './lib.mjs';

const db = dbForTarget();
const before = await db.query({
  profiles: {},
  events: {},
  invitations: {},
  seatClaims: {},
  wallPosts: {},
  reminderJobs: {},
  notificationAttempts: {},
  $files: {},
  $users: {},
});
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
for (const entity of deletionOrder) {
  const rows = before[entity] ?? [];
  if (rows.length) {
    await db.transact(rows.map((row) => db.tx[entity][row.id].delete()));
  }
}
for (const name of ['alice', 'bob', 'mallory']) {
  await db.auth.deleteUser({ email: actorEmail(name) }).catch(() => null);
}
const after = await queryCounts(db);
writeJson(resolve(receiptsDir, `fixture-reset-${Date.now()}.json`), {
  capturedAt: new Date().toISOString(),
  targetIdSha256: sha256(db.config.appId),
  reason: 'retained seed attempt 1 failed after its transaction committed',
  beforeCounts: Object.fromEntries(
    Object.entries(before).map(([key, value]) => [key, Array.isArray(value) ? value.length : value ? 1 : 0]),
  ),
  afterCounts: after,
  exactFreshTargetOnly: true,
});
if (Object.values(after).some((count) => count !== 0)) {
  throw new Error(`fixture reset incomplete: ${JSON.stringify(after)}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, after })}\n`);
