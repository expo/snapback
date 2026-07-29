import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = JSON.parse(
  readFileSync(resolve(root, '.arm-runtime/target.json'), 'utf8'),
);
const receiptDir = resolve(root, '../receipts');
mkdirSync(receiptDir, { recursive: true });
const targetIdSha256 = createHash('sha256').update(target.appId).digest('hex');
const result = spawnSync(
  resolve(root, 'node_modules/.bin/instant-cli'),
  ['app', 'delete', '--app', target.appId, '--token', target.adminToken, '--yes'],
  {
    cwd: root,
    env: {
      ...process.env,
      HOME: resolve(root, '.arm-runtime/home'),
      XDG_CONFIG_HOME: resolve(root, '.arm-runtime/xdg/config'),
      XDG_CACHE_HOME: resolve(root, '.arm-runtime/xdg/cache'),
      XDG_DATA_HOME: resolve(root, '.arm-runtime/xdg/data'),
    },
    encoding: 'utf8',
  },
);
const scrub = (value) =>
  String(value ?? '')
    .replaceAll(target.appId, '[APP_ID]')
    .replaceAll(target.adminToken, '[ADMIN_TOKEN]');
const receipt = {
  operation: 'delete-exact-disposable-target',
  targetIdSha256,
  exitCode: result.status,
  stdout: scrub(result.stdout),
  stderr: scrub(result.stderr),
  finishedAt: new Date().toISOString(),
};
writeFileSync(
  resolve(receiptDir, `target-delete-${Date.now()}.json`),
  JSON.stringify(receipt, null, 2) + '\n',
  { mode: 0o600 },
);
process.stdout.write(
  JSON.stringify({ ok: result.status === 0, targetIdSha256 }) + '\n',
);
process.exit(result.status ?? 1);
