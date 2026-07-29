import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { init } from '@instantdb/admin';

const root = resolve(import.meta.dirname, '..');
const target = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'),
);
const targetIdSha256 = createHash('sha256').update(target.appId).digest('hex');
const actorsPath = resolve(root, '.arm-runtime/actors.json');
const actors = existsSync(actorsPath)
  ? JSON.parse(readFileSync(actorsPath, 'utf8'))
  : null;
const receiptDir = resolve(root, '../receipts');
mkdirSync(receiptDir, { recursive: true });
const admin = init({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});
const before = await admin.query({
  channels: {},
  messages: {},
  readMarkers: {},
  $users: {},
});
for (const namespace of ['messages', 'readMarkers', 'channels']) {
  for (let offset = 0; offset < before[namespace].length; offset += 100) {
    await admin.transact(
      before[namespace]
        .slice(offset, offset + 100)
        .map((entity) => admin.tx[namespace][entity.id].delete()),
    );
  }
}
for (const user of before.$users) {
  await admin.auth.deleteUser({ id: user.id });
}
const after = await admin.query({
  channels: {},
  messages: {},
  readMarkers: {},
  $users: {},
});
let oldActorTokenInvalidated = null;
if (actors?.bob?.refreshToken) {
  try {
    await admin.auth.verifyToken(actors.bob.refreshToken);
    oldActorTokenInvalidated = false;
  } catch {
    oldActorTokenInvalidated = true;
  }
}
const counts = (value) =>
  Object.fromEntries(
    Object.entries(value).map(([namespace, rows]) => [
      namespace,
      rows.length,
    ]),
  );
const receipt = {
  operation: 'clear-exact-disposable-target',
  targetIdSha256,
  beforeCounts: counts(before),
  afterCounts: counts(after),
  exactTargetOnly: true,
  targetDeletionUnsupportedWithAppScopedAdminToken: true,
  providerManagedExpiryExpected: true,
  temporaryAppLifecycle:
    'instant-cli documents automatic deletion after >24 hours',
  residualConfigurationUntilProviderExpiry: ['schema', 'permissions'],
  oldActorTokenInvalidated,
  localRuntimeCredentialsRemoved: true,
  finishedAt: new Date().toISOString(),
};
const ok = Object.values(receipt.afterCounts).every((count) => count === 0);
writeFileSync(
  resolve(receiptDir, 'cleanup-final.json'),
  JSON.stringify({ ...receipt, ok }, null, 2) + '\n',
  { mode: 0o600 },
);
rmSync(actorsPath, { force: true });
rmSync(resolve(root, '.arm-runtime/target.json'), { force: true });
process.stdout.write(JSON.stringify({ ok, ...receipt }) + '\n');
process.exit(ok ? 0 : 1);
