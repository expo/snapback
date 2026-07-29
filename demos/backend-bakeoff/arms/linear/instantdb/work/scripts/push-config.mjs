import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const runtimePath = resolve(root, '.arm-runtime/target.json');
const receiptDir = resolve(root, '../receipts');
const target = JSON.parse(readFileSync(runtimePath, 'utf8'));

mkdirSync(receiptDir, { recursive: true });
const startedAt = new Date().toISOString();
const result = spawnSync(
  resolve(root, 'node_modules/.bin/instant-cli'),
  ['push', 'all', '--app', target.appId, '--yes'],
  {
    cwd: root,
    env: {
      ...process.env,
      HOME: resolve(root, '.arm-runtime/home'),
      XDG_CONFIG_HOME: resolve(root, '.arm-runtime/xdg/config'),
      XDG_CACHE_HOME: resolve(root, '.arm-runtime/xdg/cache'),
      XDG_DATA_HOME: resolve(root, '.arm-runtime/xdg/data'),
      INSTANT_CLI_AUTH_TOKEN: target.adminToken,
    },
    encoding: 'utf8',
  },
);

const scrub = (value) =>
  String(value ?? '')
    .replaceAll(target.appId, '[APP_ID]')
    .replaceAll(target.adminToken, '[ADMIN_TOKEN]')
    .slice(-12_000);
const receipt = {
  operation: 'push-schema-and-permissions',
  startedAt,
  finishedAt: new Date().toISOString(),
  targetIdSha256: createHash('sha256').update(target.appId).digest('hex'),
  exitCode: result.status,
  stdout: scrub(result.stdout),
  stderr: scrub(result.stderr),
};
writeFileSync(
  resolve(receiptDir, `config-push-${Date.now()}.json`),
  JSON.stringify(receipt, null, 2) + '\n',
  { mode: 0o600 },
);
if (result.status !== 0) {
  process.stderr.write(receipt.stderr || receipt.stdout);
  process.exit(result.status ?? 1);
}
process.stdout.write(
  JSON.stringify({
    ok: true,
    targetIdSha256: receipt.targetIdSha256,
    receipt: `../receipts/config-push-${Date.now()}.json`,
  }) + '\n',
);
