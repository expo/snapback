import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init } from '@instantdb/admin';

const root = resolve(import.meta.dirname, '..');
const target = JSON.parse(readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'));
const receiptDir = resolve(root, '../receipts');
mkdirSync(receiptDir, { recursive: true });
const admin = init({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});
const query = {
  organizations: {}, memberships: {}, teams: {}, projects: {}, labels: {},
  issues: {}, comments: {}, activities: {},
};
const before = await admin.query(query);
for (const namespace of [
  'comments', 'activities', 'issues', 'labels', 'teams', 'projects',
  'memberships', 'organizations',
]) {
  for (let offset = 0; offset < before[namespace].length; offset += 100) {
    await admin.transact(
      before[namespace]
        .slice(offset, offset + 100)
        .map((entity) => admin.tx[namespace][entity.id].delete()),
    );
  }
}
const after = await admin.query(query);
const counts = (data) => Object.fromEntries(
  Object.entries(data).map(([namespace, rows]) => [namespace, rows.length]),
);
const receipt = {
  operation: 'reset-fixture-after-retained-harness-failure',
  targetIdSha256: createHash('sha256').update(target.appId).digest('hex'),
  beforeCounts: counts(before),
  afterCounts: counts(after),
  nativeUsersPreservedForActorIdentityContinuity: true,
  finishedAt: new Date().toISOString(),
};
receipt.ok = Object.values(receipt.afterCounts).every((count) => count === 0);
writeFileSync(
  resolve(receiptDir, `fixture-reset-${Date.now()}.json`),
  JSON.stringify(receipt, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(receipt) + '\n');
process.exit(receipt.ok ? 0 : 1);
