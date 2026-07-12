// ENG-24364 / ENG-24388: exercise deploy.sh without touching Cloudflare.
// PATH-local npx/curl fakes model every existing/missing permutation,
// ambiguous probes, partial failures, and admin-secret state transitions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceCloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-deploy-test-'));
const bin = path.join(temp, 'bin');
fs.mkdirSync(bin);
const fixtureRepo = path.join(temp, 'fixture-repo');
const cloudflareRoot = path.join(fixtureRepo, 'cloudflare');
fs.mkdirSync(cloudflareRoot, { recursive: true });
fs.mkdirSync(path.join(fixtureRepo, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(fixtureRepo, 'demos/all-aboard/surfaces/contract'), { recursive: true });
fs.copyFileSync(path.join(sourceCloudflareRoot, 'deploy.sh'), path.join(cloudflareRoot, 'deploy.sh'));
for (const name of fs.readdirSync(sourceCloudflareRoot)) {
  if (/^wrangler.*\.jsonc$/.test(name)) fs.copyFileSync(path.join(sourceCloudflareRoot, name), path.join(cloudflareRoot, name));
}
fs.writeFileSync(
  path.join(fixtureRepo, 'scripts/cf-check-compat'),
  '#!/usr/bin/env bash\nset -eu\n: > "$MOCK_COMPAT_MARKER"\n',
  { mode: 0o755 }
);

const npxFake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1]; };
const config = value('--config');
const canonical = config.replace(/^\\.bootstrap\\.\\d+\\./, '');
const statePath = process.env.MOCK_STATE;
let state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : { active: {}, sequence: 0, healthCalls: 0, initialized: false };
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
  state.active[target] = [{ version_id: 'new-' + state.sequence + '-' + target.replace(/[^A-Za-z0-9]/g, '-'), percentage: 100 }];
  save();
};
if (args[0] !== 'wrangler') process.exit(90);
if (args[1] === 'deployments' && args[2] === 'list') {
  const ambiguousAfter = state.failureSeen && (process.env.MOCK_AMBIGUOUS_AFTER_FAILURE || '').split(',').includes(config);
  if ((process.env.MOCK_AMBIGUOUS || '').split(',').includes(config) || ambiguousAfter) {
    console.error('authentication failed while contacting api.cloudflare.com');
    process.exit(1);
  }
  if ((process.env.MOCK_EMPTY_DEPLOYMENTS || '').split(',').includes(config)) {
    console.log('[]');
    process.exit(0);
  }
  if (state.active[config]) {
    console.log(JSON.stringify([{ created_on: '2026-07-12T00:00:00.000Z', versions: state.active[config] }]));
    process.exit(0);
  }
  console.error('Worker not found (code 10090)');
  process.exit(1);
}
if (args[1] === 'deploy') {
  const match = process.env.MOCK_FAIL_DEPLOY_MATCH || '';
  const exact = process.env.MOCK_FAIL_DEPLOY_EXACT || '';
  const failing = (match && config.includes(match)) || (exact && config === exact);
  if (!failing || process.env.MOCK_FAIL_AFTER_ACTIVATE === '1') activate(canonical);
  if (failing) {
    state.failureSeen = true;
    save();
    console.error('injected deploy failure');
    process.exit(7);
  }
  console.log('https://snapback-notes-proof.test.workers.dev');
  process.exit(0);
}
if (args[1] === 'versions' && args[2] === 'deploy') {
  if ((process.env.MOCK_FAIL_ROLLBACK_CONFIG || '').split(',').includes(config)) process.exit(9);
  const end = args.indexOf('--config');
  const specs = args.slice(3, end).filter((item) => item.includes('@'));
  state.active[config] = specs.map((spec) => {
    const at = spec.lastIndexOf('@');
    return { version_id: spec.slice(0, at), percentage: Number(spec.slice(at + 1)) };
  });
  save();
  process.exit(0);
}
if (args[1] === 'delete') {
  delete state.active[config];
  save();
  process.exit(0);
}
if (args[1] === 'secret' && args[2] === 'list') {
  if (process.env.MOCK_SECRET_LIST_FAIL === '1') {
    console.error('injected secret-list failure');
    process.exit(8);
  }
  console.log(JSON.stringify(state.secretPresent ? [{ name: 'SNAPBACK_ADMIN_TOKEN', type: 'secret_text' }] : []));
  process.exit(0);
}
if (args[1] === 'secret' && args[2] === 'put') {
  fs.readFileSync(0);
  state.secretPresent = true;
  activate(canonical);
  if (process.env.MOCK_FAIL_SECRET_AFTER_ACTIVATE === '1') process.exit(7);
  process.exit(0);
}
if (args[1] === 'secret' && args[2] === 'delete') {
  fs.readFileSync(0);
  state.secretPresent = false;
  activate(canonical);
  if (process.env.MOCK_FAIL_SECRET_AFTER_ACTIVATE === '1') process.exit(7);
  process.exit(0);
}
console.error('unexpected mock npx call', args);
process.exit(91);
`;
const curlFake = `#!/usr/bin/env node
const fs = require('node:fs');
const state = JSON.parse(fs.readFileSync(process.env.MOCK_STATE, 'utf8'));
state.healthCalls += 1;
fs.writeFileSync(process.env.MOCK_STATE, JSON.stringify(state));
const failAfter = Number(process.env.MOCK_HEALTH_FAIL_AFTER_CALL || 0);
const actionHandler = process.env.SNAPBACK_CF_APP === 'all-aboard';
if (process.env.MOCK_HEALTH_FAIL === '1' || (failAfter > 0 && state.healthCalls >= failAfter)) {
  console.log(JSON.stringify({ ok: true, bindings: { handler: false, actionHandler: false } }));
} else if (process.env.MOCK_HEALTH_STALE === '1') {
  console.log(JSON.stringify({ ok: false, code: 'SNAPBACK_STALE_CLOUDFLARE_INPUTS_HASH', bindings: { handler: true, actionHandler } }));
} else {
  console.log(JSON.stringify({ ok: true, bindings: { handler: true, actionHandler } }));
}
`;
fs.writeFileSync(path.join(bin, 'npx'), npxFake, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'curl'), curlFake, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'bun'), '#!/usr/bin/env bash\\nexit 0\\n', { mode: 0o755 });

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
    MOCK_LOG: log,
    MOCK_STATE: state,
    MOCK_COMPAT_MARKER: marker,
    MOCK_EXISTING: 'wrangler.handler.jsonc,wrangler.jsonc',
    MOCK_SECRET_STATE: 'absent',
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

function deployConfigs(result, bootstrap) {
  return result.calls
    .filter((args) => args[1] === 'deploy')
    .map((args) => args[args.indexOf('--config') + 1])
    .filter((config) => config.includes('.bootstrap.') === bootstrap);
}

function deletedConfigs(result) {
  return result.calls
    .filter((args) => args[1] === 'delete')
    .map((args) => args[args.indexOf('--config') + 1]);
}

function rollbackConfigs(result) {
  return result.calls
    .filter((args) => args[1] === 'versions' && args[2] === 'deploy')
    .map((args) => args[args.indexOf('--config') + 1]);
}

try {
  const existing = run('all-existing');
  assert.equal(existing.status, 0, existing.output);
  assert.deepEqual(deployConfigs(existing, true), []);
  assert.match(existing.output, /remote state: verified ABSENT/);
  assert.equal(existing.compatChecked, true, 'deploy must always run the compat preflight');

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

  const staleHealth = run('stale-health', { MOCK_EXISTING: '', MOCK_HEALTH_STALE: '1' });
  assert.notEqual(staleHealth.status, 0);
  assert.match(staleHealth.output, /DEPLOYED BINDINGS VERIFIED, BUT HEALTH REFUSED/);
  assert.deepEqual(new Set(deletedConfigs(staleHealth)), new Set(['wrangler.handler.jsonc', 'wrangler.jsonc']));

  const allAboardExisting = [
    'wrangler.all-aboard.handler.jsonc',
    'wrangler.all-aboard.action-handler.jsonc',
    'wrangler.all-aboard.jsonc',
  ].join(',');
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

  const allAboardBootstrapFailure = run('all-aboard-bootstrap-activated-failure', {
    SNAPBACK_CF_APP: 'all-aboard',
    MOCK_EXISTING: '',
    MOCK_FAIL_DEPLOY_MATCH: 'action-handler.jsonc',
    MOCK_FAIL_AFTER_ACTIVATE: '1',
  });
  assert.notEqual(allAboardBootstrapFailure.status, 0);
  assert.deepEqual(deletedConfigs(allAboardBootstrapFailure), [
    'wrangler.all-aboard.action-handler.jsonc',
    'wrangler.all-aboard.jsonc',
    'wrangler.all-aboard.handler.jsonc',
  ]);

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
  assert.match(removed.output, /verified SNAPBACK_ADMIN_TOKEN absent/);
  assert.ok(removed.calls.some((args) => args[1] === 'secret' && args[2] === 'delete'));

  const rotated = run('token-rotated', { SNAPBACK_ADMIN_TOKEN: 'never-log-this-secret' });
  assert.equal(rotated.status, 0, rotated.output);
  assert.ok(rotated.calls.some((args) => args[1] === 'secret' && args[2] === 'put'));
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
  assert.match(finalHealthFailure.output, /DEPLOY FAILED FINAL VERIFICATION/);
  assert.deepEqual(rollbackConfigs(finalHealthFailure), ['wrangler.handler.jsonc', 'wrangler.jsonc']);

  console.log('cloudflare deploy-script acceptance: mixed bootstrap, rollback, and admin-secret states passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
