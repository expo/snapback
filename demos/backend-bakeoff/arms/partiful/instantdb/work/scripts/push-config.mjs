import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readTarget, receiptsDir, runtimeDir, scrub, sha256, workRoot, writeJson } from './lib.mjs';

const target = readTarget();
const startedAt = new Date().toISOString();
const startedMonotonicMs = Math.round(requireUptime());
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
const receiptPath = resolve(receiptsDir, `config-push-${Date.now()}.json`);
writeJson(receiptPath, {
  operation: 'push-schema-and-permissions',
  startedAt,
  finishedAt: new Date().toISOString(),
  startedMonotonicMs,
  finishedMonotonicMs: Math.round(requireUptime()),
  targetIdSha256: sha256(target.appId),
  exitStatus: result.status,
  stdout: scrub(result.stdout, target),
  stderr: scrub(result.stderr, target),
});
if (result.status !== 0) {
  process.stderr.write(scrub(result.stderr || result.stdout, target));
  process.exit(result.status ?? 1);
}
process.stdout.write(`${JSON.stringify({ ok: true, targetIdSha256: sha256(target.appId) })}\n`);

function requireUptime() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}
