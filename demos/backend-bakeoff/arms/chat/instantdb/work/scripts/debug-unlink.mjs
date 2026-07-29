import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { init } from '@instantdb/admin';

const root = resolve(import.meta.dirname, '..');
const target = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'),
);
const actors = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/actors.json'), 'utf8'),
);
const admin = init({
  appId: target.appId,
  adminToken: target.adminToken,
  disableValidation: true,
});
const data = await admin.query({ channels: {} });
const calibration = data.channels.find(
  (channel) => channel.name === 'calibration',
);
const scoped = admin.asUser({ token: actors.alice.refreshToken });
const result = await scoped.debugTransact(
  admin.tx.channels[calibration.id].unlink({ allowedUsers: actors.bob.id }),
);
writeFileSync(
  resolve(root, '.arm-runtime/debug-unlink.json'),
  JSON.stringify(result, null, 2),
  { mode: 0o600 },
);
process.stdout.write(
  JSON.stringify({
    ok: true,
    topLevelKeys: Object.keys(result),
    checkCount: Array.isArray(result?.['check-results'])
      ? result['check-results'].length
      : null,
    checkShapes: (result?.['check-results'] ?? []).map((check) => ({
      keys: Object.keys(check),
      allowed: check.allowed ?? check['check-result'] ?? null,
      namespace: check.namespace ?? check.etype ?? null,
      action: check.action ?? null,
    })),
  }) + '\n',
);
