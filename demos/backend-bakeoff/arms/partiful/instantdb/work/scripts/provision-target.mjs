import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  frozenStart,
  frozenStartMonotonicMs,
  namespace,
  receiptsDir,
  runtimeDir,
  sha256,
  workRoot,
  writeJson,
} from './lib.mjs';

const xdgRoot = resolve(runtimeDir, 'xdg');
for (const leaf of ['config', 'cache', 'data', 'state']) {
  mkdirSync(resolve(xdgRoot, leaf), { recursive: true, mode: 0o700 });
}

writeJson(resolve(receiptsDir, 'preflight.json'), {
  capturedAt: frozenStart,
  startedMonotonicMs: frozenStartMonotonicMs,
  sourceCommit: 'e7f22d65ba6c419b67557e88b4eab50f0fd44866',
  snapbackCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
  freezeAggregateSha256: 'ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a',
  provider: 'InstantDB',
  providerVersion: '1.0.52',
  targetMode: 'fresh-hosted-temporary',
  intendedTitle: namespace,
  intendedTargetAbsent: true,
  absenceBasis: 'init-without-files --temp always creates a new opaque app identity; no shared target is selected',
  accountCapability: 'anonymous temporary app creation; no account credential used',
  plan: 'official temporary/free app',
  region: 'provider-selected and not exposed',
  isolatedState: {
    worktree: '/private/tmp/llp0102-partiful-instantdb-w3',
    xdgRoot: '.arm-runtime/xdg',
    vitePort: 4337,
    browserDebugPort: 9337,
  },
  portPreflight: { 4337: 'unused', 9337: 'unused' },
  processPreflight: 'no arm-owned process',
  cleanupIntent: 'delete exact app-owned entities/files/users, revoke local token material, rely on documented temporary-app expiry for app shell',
  containsCredentialValues: false,
});

const result = spawnSync(
  resolve(workRoot, 'node_modules/.bin/instant-cli'),
  ['init-without-files', '--title', namespace, '--temp'],
  {
    cwd: workRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve(xdgRoot, 'config'),
      XDG_CACHE_HOME: resolve(xdgRoot, 'cache'),
      XDG_DATA_HOME: resolve(xdgRoot, 'data'),
      XDG_STATE_HOME: resolve(xdgRoot, 'state'),
    },
  },
);

const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const match = combined.match(/\{[\s\S]*\}/);
let parsed;
try {
  parsed = match ? JSON.parse(match[0]) : null;
} catch {
  parsed = null;
}
const appId = parsed?.app?.appId ?? parsed?.appId;
const adminToken = parsed?.app?.adminToken ?? parsed?.adminToken;
if (result.status !== 0 || !appId || !adminToken) {
  writeJson(resolve(receiptsDir, `target-provision-failure-${Date.now()}.json`), {
    capturedAt: new Date().toISOString(),
    exitStatus: result.status,
    classification: result.status === 0 ? 'builder-parse-error' : 'provider-or-environment',
    stdoutTail: combined.slice(-4000),
    credentialRetained: false,
  });
  throw new Error(`temporary app provisioning failed or returned an unexpected shape (exit ${result.status})`);
}

const target = {
  appId,
  adminToken,
  title: namespace,
  mode: 'fresh-hosted-temporary',
  provisionedAt: new Date().toISOString(),
};
const targetPath = resolve(runtimeDir, 'target.json');
writeJson(targetPath, target);
chmodSync(targetPath, 0o600);
writeJson(resolve(receiptsDir, 'target-provision-redacted.json'), {
  capturedAt: target.provisionedAt,
  targetMode: target.mode,
  title: namespace,
  targetIdSha256: sha256(appId),
  adminTokenSha256: sha256(adminToken),
  providerReceipt: 'instant-cli init-without-files --temp exited 0',
  lifecycle: 'provider documents automatic deletion after more than 24 hours',
  placement: 'provider-selected; exact region not exposed',
  credentialsPersistedOnlyAt: 'work/.arm-runtime/target.json (0600, ignored)',
  isolatedXdgState: 'work/.arm-runtime/xdg',
  containsCredentialValues: false,
});
process.stdout.write(`${JSON.stringify({ ok: true, targetIdSha256: sha256(appId), title: namespace })}\n`);
