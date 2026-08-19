// ENG-24364 / ENG-24388 / ENG-24499: exercise deploy.sh without touching
// Cloudflare. A repo-local pinned Wrangler and PATH-local curl fake model every
// existing/missing permutation, ambiguous probe, partial failure, and
// admin-secret state transition.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceCloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRepoRoot = path.resolve(sourceCloudflareRoot, '../..');
const contractSurfaceRoot = path.join(sourceRepoRoot, 'demos/all-aboard/surfaces/contract');
const deploySource = fs.readFileSync(path.join(sourceCloudflareRoot, 'deploy.sh'), 'utf8');
for (const code of [
  'SNAPBACK_CF_DEPLOY_APP_UNKNOWN',
  'SNAPBACK_CF_DEPLOY_SOURCE_OVERRIDE_REFUSED',
  'SNAPBACK_CF_DEPLOY_CREDENTIAL_MISSING',
  'SNAPBACK_CF_DEPLOY_PROBE_URL_UNAVAILABLE',
  'SNAPBACK_CF_DEPLOY_BINDING_VERIFICATION_FAILED',
  'SNAPBACK_CF_DEPLOY_HEALTH_REFUSED',
  'SNAPBACK_CF_DEPLOY_ADMIN_SECRET_CONFLICT',
  'SNAPBACK_CF_DEPLOY_ADMIN_SECRET_SET_UNVERIFIED',
  'SNAPBACK_CF_DEPLOY_ADMIN_SECRET_REMOVE_UNVERIFIED',
  'SNAPBACK_CF_DEPLOY_FINAL_BINDING_VERIFICATION_FAILED',
  'SNAPBACK_CF_DEPLOY_FINAL_HEALTH_VERIFICATION_FAILED',
  'SNAPBACK_CF_DEPLOY_VERSION_ATTESTATION_FAILED',
]) {
  assert.match(deploySource, new RegExp(`\\b${code}\\b`), `${code} must remain stable`);
}
assert.doesNotMatch(
  fs.readFileSync(path.join(sourceCloudflareRoot, 'wrangler.jsonc'), 'utf8'),
  /\bnpx\s+wrangler\b/,
  'operator-facing deploy config must not recommend an auto-installing production controller',
);
assert.match(
  deploySource,
  /SNAPBACK_ALL_ABOARD_TARGET_PROFILE=cloudflare-do-sqlite-v8\s+bun run build/,
  'the hosted All Aboard bundle must select the pre-auth Cloudflare target explicitly',
);
for (const [entry, baseResolver] of [
  ['main.ts', 'snapbackWebBaseUrl'],
  ['native.ts', 'snapbackNativeBaseUrl'],
]) {
  const source = fs.readFileSync(path.join(contractSurfaceRoot, entry), 'utf8');
  assert.match(
    source,
    /new SnapbackClient\(snapbackBaseUrl\(\), snapbackTargetClientOptions\(\)\)/,
    `${entry} must construct the production client through the target-profile options`,
  );
  assert.match(
    source,
    new RegExp(`${baseResolver}\\(__SNAPBACK_API_ORIGIN__, origin\\)`),
    `${entry} must resolve its API origin through the target profile`,
  );
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-deploy-test-'));
const bin = path.join(temp, 'bin');
fs.mkdirSync(bin);
const fixtureRepo = path.join(temp, 'fixture-repo');
const cloudflareRoot = path.join(fixtureRepo, 'targets/cloudflare');
fs.mkdirSync(cloudflareRoot, { recursive: true });
fs.mkdirSync(path.join(fixtureRepo, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(fixtureRepo, 'demos/all-aboard/surfaces/contract'), { recursive: true });
fs.copyFileSync(path.join(sourceCloudflareRoot, 'deploy.sh'), path.join(cloudflareRoot, 'deploy.sh'));
fs.copyFileSync(path.join(sourceCloudflareRoot, 'locked-wrangler.mjs'), path.join(cloudflareRoot, 'locked-wrangler.mjs'));
fs.copyFileSync(path.join(sourceCloudflareRoot, 'wrangler.lock.json'), path.join(cloudflareRoot, 'wrangler.lock.json'));
for (const name of fs.readdirSync(sourceCloudflareRoot)) {
  if (/^wrangler.*\.jsonc$/.test(name)) fs.copyFileSync(path.join(sourceCloudflareRoot, name), path.join(cloudflareRoot, name));
}
fs.writeFileSync(
  path.join(fixtureRepo, 'scripts/cf-check-compat'),
  '#!/usr/bin/env bash\nset -eu\n: > "$MOCK_COMPAT_MARKER"\n',
  { mode: 0o755 }
);

const wranglerRoot = path.join(fixtureRepo, 'node_modules', 'wrangler');
const wranglerBin = path.join(wranglerRoot, 'bin', 'wrangler.js');
const wranglerPackage = path.join(wranglerRoot, 'package.json');
fs.mkdirSync(path.dirname(wranglerBin), { recursive: true });
fs.writeFileSync(path.join(fixtureRepo, 'bun.lock'), '{"packages":{"wrangler":["wrangler@4.108.0"]}}\n');
fs.writeFileSync(
  wranglerPackage,
  '{"version":"4.108.0","bin":{"wrangler":"bin/wrangler.js"}}\n',
);

const wranglerFake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1]; };
const config = value('--config');
const canonical = config.replace(/^\\.bootstrap\\.\\d+\\./, '');
const statePath = process.env.MOCK_STATE;
let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { active: {}, previous: {}, pending: {}, sequence: 0, healthCalls: 0, initialized: false };
state.previous ||= {};
state.pending ||= {};
if (!state.initialized) {
  for (const item of (process.env.MOCK_EXISTING || '').split(',').filter(Boolean)) {
    state.active[item] = [{ version_id: 'old-' + item.replace(/[^A-Za-z0-9]/g, '-'), percentage: 100 }];
  }
  state.secretPresent = process.env.MOCK_SECRET_STATE === 'present';
  state.initialized = true;
  fs.writeFileSync(statePath, JSON.stringify(state));
}
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const activate = (target) => {
  state.sequence += 1;
  const next = [{ version_id: 'new-' + state.sequence + '-' + target.replace(/[^A-Za-z0-9]/g, '-'), percentage: 100 }];
  state.pending[target] = { versions: next, remaining: Number(process.env.MOCK_CONTROL_LAG_CALLS || 0) };
  save();
  return next[0].version_id;
};
if (args[0] === 'deployments' && args[1] === 'list') {
  const ambiguousAfter = state.failureSeen && (process.env.MOCK_AMBIGUOUS_AFTER_FAILURE || '').split(',').includes(config);
  if ((process.env.MOCK_AMBIGUOUS || '').split(',').includes(config) || ambiguousAfter) {
    console.error('authentication failed while contacting api.cloudflare.com');
    process.exit(1);
  }
  if ((process.env.MOCK_EMPTY_DEPLOYMENTS || '').split(',').includes(config)) {
    console.log('[]');
    process.exit(0);
  }
  const pending = state.pending[config];
  if (pending) {
    const isGateway = config === 'wrangler.jsonc' || config === 'wrangler.all-aboard.jsonc';
    if (isGateway && process.env.MOCK_FOREIGN_GATEWAY_AFTER_DEPLOY === '1' && !state.foreignInjected) {
      state.sequence += 1;
      if (state.active[config]) state.previous[config] = state.active[config];
      state.active[config] = [{ version_id: 'foreign-' + state.sequence + '-' + config.replace(/[^A-Za-z0-9]/g, '-'), percentage: 100 }];
      delete state.pending[config];
      state.foreignInjected = true;
      save();
    } else if (pending.remaining > 0) {
      pending.remaining -= 1;
      save();
    } else {
      if (state.active[config]) state.previous[config] = state.active[config];
      state.active[config] = pending.versions;
      delete state.pending[config];
      save();
    }
  }
  if (state.active[config]) {
    console.log(JSON.stringify([{ created_on: '2026-07-12T00:00:00.000Z', versions: state.active[config] }]));
    process.exit(0);
  }
  console.error('Worker not found (code 10090)');
  process.exit(1);
}
if (args[0] === 'deploy') {
  const match = process.env.MOCK_FAIL_DEPLOY_MATCH || '';
  const exact = process.env.MOCK_FAIL_DEPLOY_EXACT || '';
  const failing = (match && config.includes(match)) || (exact && config === exact);
  let versionId = '';
  if (!failing || process.env.MOCK_FAIL_AFTER_ACTIVATE === '1') versionId = activate(canonical);
  if (failing) {
    state.failureSeen = true;
    save();
    console.error('injected deploy failure');
    process.exit(7);
  }
  console.log('https://snapback-notes-proof.test.workers.dev');
  if (process.env.MOCK_OMIT_VERSION_ID !== '1') console.log('Current Version ID: ' + versionId);
  process.exit(0);
}
if (args[0] === 'versions' && args[1] === 'deploy') {
  if ((process.env.MOCK_FAIL_ROLLBACK_CONFIG || '').split(',').includes(config)) process.exit(9);
  const end = args.indexOf('--config');
  const specs = args.slice(2, end).filter((item) => item.includes('@'));
  state.active[config] = specs.map((spec) => {
    const at = spec.lastIndexOf('@');
    return { version_id: spec.slice(0, at), percentage: Number(spec.slice(at + 1)) };
  });
  delete state.pending[config];
  save();
  process.exit(0);
}
if (args[0] === 'delete') {
  delete state.active[config];
  delete state.pending[config];
  save();
  process.exit(0);
}
if (args[0] === 'secret' && args[1] === 'list') {
  if (process.env.MOCK_SECRET_LIST_FAIL === '1') {
    console.error('injected secret-list failure');
    process.exit(8);
  }
  console.log(JSON.stringify(state.secretPresent ? [{ name: 'SNAPBACK_ADMIN_TOKEN', type: 'secret_text' }] : []));
  process.exit(0);
}
if (args[0] === 'secret' && args[1] === 'put') {
  fs.readFileSync(0);
  state.secretPresent = true;
  activate(canonical);
  if (process.env.MOCK_FAIL_SECRET_AFTER_ACTIVATE === '1') process.exit(7);
  process.exit(0);
}
if (args[0] === 'secret' && args[1] === 'delete') {
  fs.readFileSync(0);
  state.secretPresent = false;
  activate(canonical);
  if (process.env.MOCK_FAIL_SECRET_AFTER_ACTIVATE === '1') process.exit(7);
  process.exit(0);
}
console.error('unexpected mock Wrangler call', args);
process.exit(91);
`;
const curlFake = `#!/usr/bin/env node
const fs = require('node:fs');
const curlArgs = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'));
if (curlArgs.some((arg) => arg.includes('/_snapback/api/app/reset'))) {
  const prefix = 'x-snapback-admin-token: ';
  const authed = curlArgs.some((arg) => arg.startsWith(prefix) && arg.length > prefix.length);
  if (process.env.MOCK_RESET_FAIL === '1' || !authed) {
    console.log(JSON.stringify({ error: 'SNAPBACK_ADMIN_FORBIDDEN' }));
  } else {
    state.resetDone = true;
    fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
    console.log(JSON.stringify({ reset: true, seeded: true }));
  }
  process.exit(0);
}
state.healthCalls += 1;
fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
const failAfter = Number(process.env.MOCK_HEALTH_FAIL_AFTER_CALL || 0);
const wrongAfter = Number(process.env.MOCK_HEALTH_WRONG_VERSION_AFTER_CALL || 0);
const actionHandler = process.env.SNAPBACK_CF_APP === 'all-aboard';
const gatewayConfig = actionHandler ? 'wrangler.all-aboard.jsonc' : 'wrangler.jsonc';
const activeVersion = state.active[gatewayConfig]?.[0]?.version_id || null;
const previousVersion = state.previous?.[gatewayConfig]?.[0]?.version_id || 'stale-healthy-version';
const wrongVersion = process.env.MOCK_HEALTH_WRONG_VERSION === '1' || (wrongAfter > 0 && state.healthCalls >= wrongAfter);
const workerVersion = { id: wrongVersion ? previousVersion : activeVersion, tag: '', timestamp: '2026-07-12T00:00:00.000Z' };
if (process.env.MOCK_HEALTH_FAIL === '1' || (failAfter > 0 && state.healthCalls >= failAfter)) {
  console.log(JSON.stringify({ ok: true, bindings: { handler: false, actionHandler: false }, workerVersion }));
} else if (process.env.MOCK_HEALTH_STALE === '1' && !state.resetDone) {
  console.log(JSON.stringify({ ok: false, code: 'SNAPBACK_STALE_CLOUDFLARE_INPUTS_HASH', bindings: { handler: true, actionHandler }, workerVersion }));
} else {
  console.log(JSON.stringify({ ok: true, bindings: { handler: true, actionHandler }, workerVersion }));
}
`;
fs.writeFileSync(wranglerBin, wranglerFake, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'curl'), curlFake, { mode: 0o755 });
const bunBin = path.join(bin, 'bun');
const bunFake = '#!/usr/bin/env bash\nexit 0\n';
fs.writeFileSync(bunBin, bunFake, { mode: 0o755 });
assert.equal(
  fs.readFileSync(bunBin, 'utf8'),
  bunFake,
  'the executable fixture must contain real line feeds, not literal \\n text',
);

function run(name, extra = {}) {
  const caseRoot = path.join(temp, name);
  fs.mkdirSync(caseRoot);
  const log = path.join(caseRoot, 'calls.jsonl');
  const marker = path.join(caseRoot, 'compat-ran');
  const state = path.join(caseRoot, 'state.json');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLOUDFLARE_API_TOKEN: 'test-token',
    SNAPBACK_CF_APP: 'notes',
    SNAPBACK_DEPLOY_PROBE_URL: 'https://proof.invalid',
    SNAPBACK_DEPLOY_PROBE_ATTEMPTS: '1',
    SNAPBACK_DEPLOY_PROBE_DELAY_SECONDS: '0',
    SNAPBACK_DEPLOY_CONTROL_ATTEMPTS: '4',
    SNAPBACK_DEPLOY_CONTROL_DELAY_SECONDS: '0',
    MOCK_LOG: log,
    MOCK_STATE: state,
    MOCK_COMPAT_MARKER: marker,
    MOCK_EXISTING: 'wrangler.handler.jsonc,wrangler.jsonc',
    MOCK_SECRET_STATE: 'absent',
    EXACT_ALL_ABOARD_SOURCE_ROOT: '',
    ...extra,
  };
  const result = spawnSync('bash', ['deploy.sh'], {
    cwd: cloudflareRoot,
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
  return { ...result, output: `${result.stdout}${result.stderr}`, calls, compatChecked: fs.existsSync(marker) };
}

function deployReceipt(result) {
  const receipts = result.output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter(({ schemaVersion }) => schemaVersion === 'snapback.cloudflare-deploy-receipt.v1');
  assert.equal(receipts.length, 1, `successful deployment must emit one receipt:\n${result.output}`);
  const [receipt] = receipts;
  assert.equal(receipt.probeUrl, 'https://proof.invalid');
  assert.equal(receipt.healthCode, 'SNAPBACK_CF_DEPLOY_HEALTHY');
  assert.match(receipt.workers.gateway.activatedVersion, /^new-/);
  assert.match(receipt.workers.handler.activatedVersion, /^new-/);
  assert(Array.isArray(receipt.actionsTaken));
  return receipt;
}

function deployConfigs(result, bootstrap) {
  return result.calls
    .filter((args) => args[0] === 'deploy')
    .map((args) => args[args.indexOf('--config') + 1])
    .filter((config) => config.includes('.bootstrap.') === bootstrap);
}

function deletedConfigs(result) {
  return result.calls
    .filter((args) => args[0] === 'delete')
    .map((args) => args[args.indexOf('--config') + 1]);
}

function rollbackConfigs(result) {
  return result.calls
    .filter((args) => args[0] === 'versions' && args[1] === 'deploy')
    .map((args) => args[args.indexOf('--config') + 1]);
}

function javascriptBundleText(root) {
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
    }
  }
  return files.sort().map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

function nativeModuleSources(outDir) {
  const startupPath = path.join(
    outDir,
    '__exact/native/mac-appkit-hermes/startup.js',
  );
  const startup = fs.readFileSync(startupPath, 'utf8');
  const marker = 'const __exactDevModules = ';
  const start = startup.indexOf(marker);
  assert.notEqual(start, -1, 'native startup must embed its compiled module table');
  const valueStart = start + marker.length;
  const valueEnd = startup.indexOf(';\n', valueStart);
  assert.notEqual(valueEnd, -1, 'native startup module table must have a bounded terminator');
  return JSON.parse(startup.slice(valueStart, valueEnd));
}

function buildContractProfile(
  profile,
  configuredOrigin = profile === 'cloudflare-do-sqlite-v8'
    ? 'same-origin'
    : 'http://127.0.0.1:4420',
) {
  const originLabel = configuredOrigin === 'same-origin' ? 'same-origin' : 'direct';
  const outDir = path.join(temp, `contract-${profile}-${originLabel}`);
  const result = spawnSync(
    'bun',
    [
      '--bun',
      'node_modules/.bin/vite',
      'build',
      '--config',
      'vite.config.ts',
      '--outDir',
      outDir,
      '--emptyOutDir',
    ],
    {
      cwd: contractSurfaceRoot,
      env: {
        ...process.env,
        EXACT_ALL_ABOARD_SOURCE_ROOT: '',
        SNAPBACK_ALL_ABOARD_API: configuredOrigin,
        SNAPBACK_ALL_ABOARD_TARGET_PROFILE: profile,
      },
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(
    result.status,
    0,
    `${profile} production bundle failed:\n${result.stdout}${result.stderr}`,
  );
  // Native startup files embed a source-module dictionary for the host and
  // therefore contain both dead branches. The deployed Cloudflare static
  // surface is the web assets directory; inspect its executed bundle only.
  return {
    web: javascriptBundleText(path.join(outDir, 'assets')),
    nativeModules: nativeModuleSources(outDir),
  };
}

function assertNativeBuildConstants(bundle, { profile, apiOrigin }) {
  const targetSource = bundle.nativeModules['/snapback-target.ts']?.source ?? '';
  const nativeSource = bundle.nativeModules['/native.ts']?.source ?? '';
  assert.notEqual(targetSource, '', 'the native build must emit /snapback-target.ts');
  assert.notEqual(nativeSource, '', 'the native build must emit /native.ts');
  assert.doesNotMatch(
    targetSource,
    /\b__SNAPBACK_TARGET_PROFILE__\b/,
    'the native target module must not retain the unresolved target-profile define',
  );
  assert.ok(
    targetSource.includes(JSON.stringify(profile)),
    `the native target module must compile the ${profile} target profile`,
  );
  assert.doesNotMatch(
    nativeSource,
    /\b__SNAPBACK_API_ORIGIN__\b/,
    'the native entry must not retain the unresolved API-origin define',
  );
  assert.ok(
    nativeSource.includes(JSON.stringify(apiOrigin)),
    `the native entry must compile the ${apiOrigin} API origin`,
  );
}

try {
  const install = spawnSync(
    'bun',
    ['install', '--frozen-lockfile', '--cwd', contractSurfaceRoot],
    { encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(
    install.status,
    0,
    `All Aboard surface frozen install failed:\n${install.stdout}${install.stderr}`,
  );
  const cloudflareBundle = buildContractProfile('cloudflare-do-sqlite-v8');
  assert.match(
    cloudflareBundle.web,
    /the Cloudflare proof target does not support session credential custody/,
    'the production Cloudflare bundle must retain the explicit pre-auth client factory',
  );
  assertNativeBuildConstants(cloudflareBundle, {
    profile: 'cloudflare-do-sqlite-v8',
    apiOrigin: 'same-origin',
  });
  assert.match(
    cloudflareBundle.nativeModules['/native.ts']?.source ?? '',
    /snapbackNativeBaseUrl/,
    'the production Cloudflare native entry must resolve same-origin through the host origin',
  );
  assert.match(
    cloudflareBundle.nativeModules['/native.ts']?.source ?? '',
    /"same-origin"/,
    'the production Cloudflare native entry must pass the deployment origin sentinel to the resolver',
  );
  const localBundle = buildContractProfile('local-dev-sqlite-ibex');
  assertNativeBuildConstants(localBundle, {
    profile: 'local-dev-sqlite-ibex',
    apiOrigin: 'http://127.0.0.1:4420',
  });
  assert.match(
    localBundle.nativeModules['/native.ts']?.source ?? '',
    /snapbackNativeBaseUrl/,
    'the local native entry must resolve through the same profile-aware origin helper',
  );
  assert.match(
    localBundle.nativeModules['/native.ts']?.source ?? '',
    /http:\/\/127\.0\.0\.1:4420/,
    'the local native entry must retain its explicit auth-capable API origin',
  );
  const localSameOriginBundle = buildContractProfile(
    'local-dev-sqlite-ibex',
    'same-origin',
  );
  assertNativeBuildConstants(localSameOriginBundle, {
    profile: 'local-dev-sqlite-ibex',
    apiOrigin: 'same-origin',
  });
  assert.match(
    localSameOriginBundle.nativeModules['/native.ts']?.source ?? '',
    /"same-origin"/,
    'the local native entry must pass same-origin to the profile-aware /snapback resolver',
  );

  const sourceOverride = run('source-override-refused', {
    SNAPBACK_CF_APP: 'all-aboard',
    EXACT_ALL_ABOARD_SOURCE_ROOT: '/tmp/acceptance-only-exact-checkout',
  });
  assert.notEqual(sourceOverride.status, 0);
  assert.match(sourceOverride.output, /SNAPBACK_CF_DEPLOY_SOURCE_OVERRIDE_REFUSED/);
  assert.match(sourceOverride.output, /acceptance-only and must be unset/);
  assert.deepEqual(sourceOverride.calls, []);
  assert.equal(sourceOverride.compatChecked, false);

  // The deployment must fail before compatibility checks or any remote call
  // when the local locked tool is absent or has the wrong version.
  const savedWrangler = fs.readFileSync(wranglerBin);
  fs.rmSync(wranglerBin);
  const missingWrangler = run('missing-locked-wrangler');
  assert.notEqual(missingWrangler.status, 0);
  assert.match(missingWrangler.output, /SNAPBACK_WRANGLER_PRECHECK_FAILED/);
  assert.deepEqual(missingWrangler.calls, []);
  assert.equal(missingWrangler.compatChecked, false);
  fs.writeFileSync(wranglerBin, savedWrangler, { mode: 0o755 });

  const savedPackage = fs.readFileSync(wranglerPackage, 'utf8');
  fs.writeFileSync(wranglerPackage, '{"version":"4.109.0","bin":{"wrangler":"bin/wrangler.js"}}\n');
  const wrongWrangler = run('wrong-locked-wrangler');
  assert.notEqual(wrongWrangler.status, 0);
  assert.match(wrongWrangler.output, /installed Wrangler 4\.109\.0 does not match pinned 4\.108\.0/);
  assert.deepEqual(wrongWrangler.calls, []);
  assert.equal(wrongWrangler.compatChecked, false);
  fs.writeFileSync(wranglerPackage, savedPackage);

  const allAboardConfigs = [
    'wrangler.all-aboard.handler.jsonc',
    'wrangler.all-aboard.jsonc',
    'wrangler.all-aboard.action-handler.jsonc',
  ];
  const allAboardExisting = allAboardConfigs.join(',');

  const existing = run('all-existing');
  assert.equal(existing.status, 0, existing.output);
  const existingReceipt = deployReceipt(existing);
  assert.equal(existingReceipt.app, 'notes');
  assert.equal(existingReceipt.workers.gateway.name, 'snapback-notes-proof');
  assert.equal(existingReceipt.workers.handler.name, 'snapback-notes-handler');
  assert.equal(existingReceipt.workers.actionHandler, null);
  assert(existingReceipt.actionsTaken.includes('admin-secret:preserve'));
  assert.deepEqual(deployConfigs(existing, true), []);
  assert.match(existing.output, /remote state: verified ABSENT/);
  assert.equal(existing.compatChecked, true, 'deploy must always run the compat preflight');

  const controlLag = run('control-plane-lag', { MOCK_CONTROL_LAG_CALLS: '1' });
  assert.equal(controlLag.status, 0, controlLag.output);
  assert.match(controlLag.output, /control-plane 1\/4: gateway deploy has not exposed exact gateway version/);

  const concurrentForeignVersion = run('concurrent-foreign-version', {
    MOCK_FOREIGN_GATEWAY_AFTER_DEPLOY: '1',
  });
  assert.notEqual(concurrentForeignVersion.status, 0);
  assert.match(concurrentForeignVersion.output, /could not attest exact gateway version/);
  assert.deepEqual(rollbackConfigs(concurrentForeignVersion), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  const missingVersionId = run('missing-version-id', { MOCK_OMIT_VERSION_ID: '1' });
  assert.notEqual(missingVersionId.status, 0);
  assert.match(missingVersionId.output, /did not report exactly one Current Version ID/);
  assert.deepEqual(rollbackConfigs(missingVersionId), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  const onlyHandlerMissing = run('handler-missing', { MOCK_EXISTING: 'wrangler.jsonc' });
  assert.equal(onlyHandlerMissing.status, 0, onlyHandlerMissing.output);
  assert.equal(deployConfigs(onlyHandlerMissing, true).length, 1);
  assert.match(deployConfigs(onlyHandlerMissing, true)[0], /wrangler\.handler\.jsonc$/);

  const onlyGatewayMissing = run('gateway-missing', { MOCK_EXISTING: 'wrangler.handler.jsonc' });
  assert.equal(onlyGatewayMissing.status, 0, onlyGatewayMissing.output);
  assert.equal(deployConfigs(onlyGatewayMissing, true).length, 1);
  assert.match(deployConfigs(onlyGatewayMissing, true)[0], /wrangler\.jsonc$/);
  assert.doesNotMatch(deployConfigs(onlyGatewayMissing, true)[0], /handler/);

  const bothMissing = run('both-missing', { MOCK_EXISTING: '' });
  assert.equal(bothMissing.status, 0, bothMissing.output);
  assert.equal(deployConfigs(bothMissing, true).length, 2);
  assert.deepEqual(deletedConfigs(bothMissing), []);

  // All Aboard has three mutually bound Workers, so its mixed-state space is
  // eight cases rather than the notes fixture's four. Prove each subset
  // independently: only the confirmed-missing configs may receive a stripped
  // bootstrap, while every Worker still receives its ordinary full deploy.
  // This matrix is deliberately mechanical so adding a fourth Worker cannot
  // leave an implied-but-untested mixed state (ENG-24364).
  for (let mask = 0; mask < (1 << allAboardConfigs.length); mask += 1) {
    const present = allAboardConfigs.filter((_config, index) => (mask & (1 << index)) !== 0);
    const missing = allAboardConfigs.filter((_config, index) => (mask & (1 << index)) === 0);
    const permutation = run(`all-aboard-permutation-${mask.toString(2).padStart(3, '0')}`, {
      SNAPBACK_CF_APP: 'all-aboard',
      MOCK_EXISTING: present.join(','),
    });
    assert.equal(permutation.status, 0, permutation.output);
    const permutationReceipt = deployReceipt(permutation);
    assert.equal(permutationReceipt.app, 'all-aboard');
    assert.equal(
      permutationReceipt.workers.actionHandler.name,
      'snapback-all-aboard-action-handler',
    );
    assert.match(permutationReceipt.workers.actionHandler.activatedVersion, /^new-/);
    assert.deepEqual(
      deployConfigs(permutation, true).map((config) => config.replace(/^\.bootstrap\.\d+\./, '')),
      missing,
      `All Aboard mask ${mask.toString(2).padStart(3, '0')} bootstrapped something other than its confirmed-missing Workers`,
    );
    assert.deepEqual(
      deployConfigs(permutation, false),
      [
        'wrangler.all-aboard.handler.jsonc',
        'wrangler.all-aboard.action-handler.jsonc',
        'wrangler.all-aboard.jsonc',
      ],
      `All Aboard mask ${mask.toString(2).padStart(3, '0')} skipped or reordered a full deploy`,
    );
    assert.deepEqual(deletedConfigs(permutation), [], 'a successful mixed-state deploy must not clean up a Worker');
  }

  const ambiguous = run('ambiguous', { MOCK_AMBIGUOUS: 'wrangler.handler.jsonc' });
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.output, /refusing bootstrap/);
  assert.equal(deployConfigs(ambiguous, false).length + deployConfigs(ambiguous, true).length, 0);

  const noActiveSnapshot = run('no-active-snapshot', { MOCK_EMPTY_DEPLOYMENTS: 'wrangler.handler.jsonc' });
  assert.notEqual(noActiveSnapshot.status, 0);
  assert.match(noActiveSnapshot.output, /active deployment could not be snapshotted/);
  assert.equal(deployConfigs(noActiveSnapshot, false).length + deployConfigs(noActiveSnapshot, true).length, 0);

  // Failure on the second bootstrap must remove the first newly created
  // Worker; failures in each later stage must remove every bootstrap Worker.
  const bootstrapFailure = run('bootstrap-failure', { MOCK_EXISTING: '', MOCK_FAIL_DEPLOY_MATCH: 'wrangler.jsonc' });
  assert.notEqual(bootstrapFailure.status, 0);
  assert.deepEqual(deletedConfigs(bootstrapFailure), ['wrangler.handler.jsonc']);

  const bootstrapActivatedFailure = run('bootstrap-activated-failure', {
    MOCK_EXISTING: '',
    MOCK_FAIL_DEPLOY_MATCH: 'wrangler.handler.jsonc',
    MOCK_FAIL_AFTER_ACTIVATE: '1',
  });
  assert.notEqual(bootstrapActivatedFailure.status, 0);
  assert.deepEqual(deletedConfigs(bootstrapActivatedFailure), ['wrangler.handler.jsonc']);

  const bootstrapCleanupAmbiguous = run('bootstrap-cleanup-ambiguous', {
    MOCK_EXISTING: '',
    MOCK_FAIL_DEPLOY_MATCH: 'wrangler.handler.jsonc',
    MOCK_FAIL_AFTER_ACTIVATE: '1',
    MOCK_AMBIGUOUS_AFTER_FAILURE: 'wrangler.handler.jsonc',
  });
  assert.notEqual(bootstrapCleanupAmbiguous.status, 0);
  assert.deepEqual(deletedConfigs(bootstrapCleanupAmbiguous), []);
  assert.match(bootstrapCleanupAmbiguous.output, /could not prove missing-state restoration/);

  const handlerFailure = run('handler-failure', { MOCK_EXISTING: '', MOCK_FAIL_DEPLOY_EXACT: 'wrangler.handler.jsonc' });
  assert.notEqual(handlerFailure.status, 0);
  assert.deepEqual(new Set(deletedConfigs(handlerFailure)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  const gatewayFailure = run('gateway-failure', { MOCK_EXISTING: '', MOCK_FAIL_DEPLOY_EXACT: 'wrangler.jsonc' });
  assert.notEqual(gatewayFailure.status, 0);
  assert.deepEqual(new Set(deletedConfigs(gatewayFailure)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  const healthFailure = run('health-failure', { MOCK_EXISTING: '', MOCK_HEALTH_FAIL: '1' });
  assert.notEqual(healthFailure.status, 0);
  assert.deepEqual(new Set(deletedConfigs(healthFailure)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  const oldHealthyVersion = run('old-healthy-version', { MOCK_HEALTH_WRONG_VERSION: '1' });
  assert.notEqual(oldHealthyVersion.status, 0);
  assert.match(oldHealthyVersion.output, /not serving expected full-bindings version/);
  assert.deepEqual(rollbackConfigs(oldHealthyVersion), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  const staleHealth = run('stale-health', { MOCK_EXISTING: '', MOCK_HEALTH_STALE: '1' });
  assert.notEqual(staleHealth.status, 0);
  assert.match(staleHealth.output, /SNAPBACK_CF_DEPLOY_HEALTH_REFUSED/);
  assert.match(staleHealth.output, /DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED/);
  assert.match(staleHealth.output, /SNAPBACK_DEPLOY_RESET_ON_STALE=1/, 'the refusal must teach the operator the sanctioned escape hatch');
  assert.ok(!staleHealth.output.includes('/_snapback/api/app/reset on the new version'), 'without the knob no reset may be attempted');
  assert.deepEqual(new Set(deletedConfigs(staleHealth)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  // The opt-in stale-hash escape hatch: reset the just-activated version,
  // re-probe, and continue the normal healthy path (no rollback/cleanup).
  const staleResetKnob = run('stale-health-reset-knob', {
    MOCK_EXISTING: '',
    MOCK_HEALTH_STALE: '1',
    SNAPBACK_DEPLOY_RESET_ON_STALE: '1',
    SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret',
    SNAPBACK_DEPLOY_RESET_ATTEMPTS: '2',
    SNAPBACK_DEPLOY_RESET_DELAY_SECONDS: '0',
  });
  assert.equal(staleResetKnob.status, 0, staleResetKnob.output);
  assert(deployReceipt(staleResetKnob).actionsTaken.includes('reset:stale-persistent-state'));
  assert.match(staleResetKnob.output, /invoking authenticated \/_snapback\/api\/app\/reset on the new version/);
  assert.match(staleResetKnob.output, /health passes after reset/);
  assert.deepEqual(deletedConfigs(staleResetKnob), []);
  assert.deepEqual(rollbackConfigs(staleResetKnob), []);
  assert.doesNotMatch(JSON.stringify(staleResetKnob.calls) + staleResetKnob.output, /never-log-this-secret/);

  // A refused/failed reset must fall through to the existing failure path.
  const staleResetKnobFails = run('stale-health-reset-knob-fails', {
    MOCK_EXISTING: '',
    MOCK_HEALTH_STALE: '1',
    MOCK_RESET_FAIL: '1',
    SNAPBACK_DEPLOY_RESET_ON_STALE: '1',
    SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret',
    SNAPBACK_DEPLOY_RESET_ATTEMPTS: '2',
    SNAPBACK_DEPLOY_RESET_DELAY_SECONDS: '0',
  });
  assert.notEqual(staleResetKnobFails.status, 0);
  assert.match(staleResetKnobFails.output, /DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED/);
  assert.deepEqual(new Set(deletedConfigs(staleResetKnobFails)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  // The knob without an admin token cannot authenticate and must fail closed.
  const staleResetKnobNoToken = run('stale-health-reset-knob-no-token', {
    MOCK_EXISTING: '',
    MOCK_HEALTH_STALE: '1',
    SNAPBACK_DEPLOY_RESET_ON_STALE: '1',
  });
  assert.notEqual(staleResetKnobNoToken.status, 0);
  assert.match(staleResetKnobNoToken.output, /SNAPBACK_ADMIN_TOKEN is not in the/);
  assert.match(staleResetKnobNoToken.output, /DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED/);
  assert.deepEqual(new Set(deletedConfigs(staleResetKnobNoToken)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  const allAboardBase = { SNAPBACK_CF_APP: 'all-aboard', MOCK_EXISTING: allAboardExisting, MOCK_FAIL_AFTER_ACTIVATE: '1' };
  const existingHandlerFailure = run('existing-handler-activated-failure', {
    ...allAboardBase,
    MOCK_FAIL_DEPLOY_EXACT: 'wrangler.all-aboard.handler.jsonc',
  });
  assert.notEqual(existingHandlerFailure.status, 0);
  assert.deepEqual(rollbackConfigs(existingHandlerFailure), ['wrangler.all-aboard.handler.jsonc']);
  assert.deepEqual(deletedConfigs(existingHandlerFailure), []);

  const existingActionFailure = run('existing-action-activated-failure', {
    ...allAboardBase,
    MOCK_FAIL_DEPLOY_EXACT: 'wrangler.all-aboard.action-handler.jsonc',
  });
  assert.notEqual(existingActionFailure.status, 0);
  assert.deepEqual(rollbackConfigs(existingActionFailure), [
    'wrangler.all-aboard.handler.jsonc',
    'wrangler.all-aboard.action-handler.jsonc',
  ]);

  const existingGatewayFailure = run('existing-gateway-activated-failure', {
    ...allAboardBase,
    MOCK_FAIL_DEPLOY_EXACT: 'wrangler.all-aboard.jsonc',
  });
  assert.notEqual(existingGatewayFailure.status, 0);
  assert.deepEqual(rollbackConfigs(existingGatewayFailure), [
    'wrangler.all-aboard.handler.jsonc',
    'wrangler.all-aboard.action-handler.jsonc',
    'wrangler.all-aboard.jsonc',
  ]);

  // A Wrangler failure can arrive after the remote activation. Inject that
  // ambiguity at every stripped-bootstrap and ordinary full-deploy stage.
  // Because all three Workers began confirmed missing, cleanup must restore
  // the complete absent state in reverse dependency order every time.
  const allAboardMissingCleanupOrder = [
    'wrangler.all-aboard.action-handler.jsonc',
    'wrangler.all-aboard.jsonc',
    'wrangler.all-aboard.handler.jsonc',
  ];
  for (const [stage, config, expectedCleanup] of [
    ['handler', 'wrangler.all-aboard.handler.jsonc', ['wrangler.all-aboard.handler.jsonc']],
    ['gateway', 'wrangler.all-aboard.jsonc', ['wrangler.all-aboard.jsonc', 'wrangler.all-aboard.handler.jsonc']],
    ['action-handler', 'wrangler.all-aboard.action-handler.jsonc', allAboardMissingCleanupOrder],
  ]) {
    const failure = run(`all-aboard-bootstrap-${stage}-activated-failure`, {
      SNAPBACK_CF_APP: 'all-aboard',
      MOCK_EXISTING: '',
      MOCK_FAIL_DEPLOY_MATCH: config,
      MOCK_FAIL_AFTER_ACTIVATE: '1',
    });
    assert.notEqual(failure.status, 0);
    assert.deepEqual(deletedConfigs(failure), expectedCleanup, `${stage} bootstrap failure did not restore absence`);
  }
  for (const [stage, config] of [
    ['handler', 'wrangler.all-aboard.handler.jsonc'],
    ['action-handler', 'wrangler.all-aboard.action-handler.jsonc'],
    ['gateway', 'wrangler.all-aboard.jsonc'],
  ]) {
    const failure = run(`all-aboard-full-${stage}-activated-failure`, {
      SNAPBACK_CF_APP: 'all-aboard',
      MOCK_EXISTING: '',
      MOCK_FAIL_DEPLOY_EXACT: config,
      MOCK_FAIL_AFTER_ACTIVATE: '1',
    });
    assert.notEqual(failure.status, 0);
    assert.deepEqual(
      deletedConfigs(failure),
      allAboardMissingCleanupOrder,
      `${stage} full-deploy failure did not restore every bootstrapped Worker to absent`,
    );
  }

  const rollbackAttestationFailure = run('rollback-attestation-failure', {
    ...allAboardBase,
    MOCK_FAIL_DEPLOY_EXACT: 'wrangler.all-aboard.jsonc',
    MOCK_FAIL_ROLLBACK_CONFIG: 'wrangler.all-aboard.handler.jsonc',
  });
  assert.notEqual(rollbackAttestationFailure.status, 0);
  assert.match(rollbackAttestationFailure.output, /rollback\/cleanup attestation failed/);

  const preserved = run('token-preserved', { MOCK_SECRET_STATE: 'present' });
  assert.equal(preserved.status, 0, preserved.output);
  assert.match(preserved.output, /PRESENT and preserved/);

  const unknown = run('token-unknown', { MOCK_SECRET_LIST_FAIL: '1' });
  assert.equal(unknown.status, 0, unknown.output);
  assert.match(unknown.output, /remote state: UNKNOWN/);

  const removed = run('token-removed', { MOCK_SECRET_STATE: 'present', SNAPBACK_ADMIN_TOKEN_REMOVE: '1' });
  assert.equal(removed.status, 0, removed.output);
  assert(deployReceipt(removed).actionsTaken.includes('admin-secret:remove'));
  assert.match(removed.output, /verified SNAPBACK_ADMIN_TOKEN absent/);
  assert.ok(removed.calls.some((args) => args[0] === 'secret' && args[1] === 'delete'));
  assert.equal(deployConfigs(removed, false).filter((config) => config === 'wrangler.jsonc').length, 2);

  const noOpRemoved = run('token-remove-no-op', { SNAPBACK_ADMIN_TOKEN_REMOVE: '1' });
  assert.equal(noOpRemoved.status, 0, noOpRemoved.output);
  assert.ok(!noOpRemoved.calls.some((args) => args[0] === 'secret' && args[1] === 'delete'));
  assert.equal(deployConfigs(noOpRemoved, false).filter((config) => config === 'wrangler.jsonc').length, 1);

  const rotated = run('token-rotated', { SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret' });
  assert.equal(rotated.status, 0, rotated.output);
  assert(deployReceipt(rotated).actionsTaken.includes('admin-secret:set'));
  assert.ok(rotated.calls.some((args) => args[0] === 'secret' && args[1] === 'put'));
  assert.equal(deployConfigs(rotated, false).filter((config) => config === 'wrangler.jsonc').length, 2);
  assert.doesNotMatch(JSON.stringify(rotated.calls) + rotated.output, /never-log-this-secret/);

  const secretActivatedFailure = run('secret-activated-failure', {
    SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret',
    MOCK_FAIL_SECRET_AFTER_ACTIVATE: '1',
  });
  assert.notEqual(secretActivatedFailure.status, 0);
  assert.deepEqual(rollbackConfigs(secretActivatedFailure), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  const finalHealthFailure = run('final-health-after-secret-failure', {
    SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret',
    MOCK_HEALTH_FAIL_AFTER_CALL: '2',
  });
  assert.notEqual(finalHealthFailure.status, 0);
  assert.match(finalHealthFailure.output, /SNAPBACK_CF_DEPLOY_FINAL_BINDING_VERIFICATION_FAILED/);
  assert.deepEqual(rollbackConfigs(finalHealthFailure), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  const finalOldHealthy = run('final-old-healthy-after-secret', {
    SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret',
    MOCK_CONTROL_LAG_CALLS: '1',
    MOCK_HEALTH_WRONG_VERSION_AFTER_CALL: '2',
  });
  assert.notEqual(finalOldHealthy.status, 0);
  assert.match(finalOldHealthy.output, /SNAPBACK_CF_DEPLOY_FINAL_BINDING_VERIFICATION_FAILED/);
  assert.deepEqual(rollbackConfigs(finalOldHealthy), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  console.log('cloudflare deploy-script acceptance: mixed bootstrap, rollback, and admin-secret states passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
