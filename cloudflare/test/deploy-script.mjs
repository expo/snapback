// ENG-24364 / ENG-24388: exercise deploy.sh without touching Cloudflare.
// PATH-local npx/curl fakes model every existing/missing permutation,
// ambiguous probes, partial failures, and admin-secret state transitions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-deploy-test-'));
const bin = path.join(temp, 'bin');
fs.mkdirSync(bin);

const npxFake = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const log = process.env.MOCK_LOG;
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
const value = (flag) => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1]; };
const config = value('--config');
if (args[0] !== 'wrangler') process.exit(90);
if (args[1] === 'deployments' && args[2] === 'list') {
  if ((process.env.MOCK_AMBIGUOUS || '').split(',').includes(config)) {
    console.error('authentication failed while contacting api.cloudflare.com');
    process.exit(1);
  }
  if ((process.env.MOCK_EXISTING || '').split(',').includes(config)) {
    console.log('[]');
    process.exit(0);
  }
  console.error('Worker not found (code 10090)');
  process.exit(1);
}
if (args[1] === 'deploy') {
  const match = process.env.MOCK_FAIL_DEPLOY_MATCH || '';
  const exact = process.env.MOCK_FAIL_DEPLOY_EXACT || '';
  if ((match && config.includes(match)) || (exact && config === exact)) {
    console.error('injected deploy failure');
    process.exit(7);
  }
  console.log('https://snapback-notes-proof.test.workers.dev');
  process.exit(0);
}
if (args[1] === 'delete') process.exit(0);
if (args[1] === 'secret' && args[2] === 'list') {
  if (process.env.MOCK_SECRET_LIST_FAIL === '1') {
    console.error('injected secret-list failure');
    process.exit(8);
  }
  const deleted = fs.existsSync(process.env.MOCK_DELETED_MARKER);
  const present = process.env.MOCK_SECRET_STATE === 'present' && !deleted;
  console.log(JSON.stringify(present ? [{ name: 'SNAPBACK_ADMIN_TOKEN', type: 'secret_text' }] : []));
  process.exit(0);
}
if (args[1] === 'secret' && args[2] === 'put') {
  fs.readFileSync(0);
  process.exit(0);
}
if (args[1] === 'secret' && args[2] === 'delete') {
  fs.readFileSync(0);
  fs.writeFileSync(process.env.MOCK_DELETED_MARKER, 'deleted');
  process.exit(0);
}
console.error('unexpected mock npx call', args);
process.exit(91);
`;
const curlFake = `#!/usr/bin/env node
if (process.env.MOCK_HEALTH_FAIL === '1') {
  console.log(JSON.stringify({ ok: true, bindings: { handler: false, actionHandler: false } }));
} else if (process.env.MOCK_HEALTH_STALE === '1') {
  console.log(JSON.stringify({ ok: false, code: 'SNAPBACK_STALE_CLOUDFLARE_INPUTS_HASH', bindings: { handler: true, actionHandler: false } }));
} else {
  console.log(JSON.stringify({ ok: true, bindings: { handler: true, actionHandler: false } }));
}
`;
fs.writeFileSync(path.join(bin, 'npx'), npxFake, { mode: 0o755 });
fs.writeFileSync(path.join(bin, 'curl'), curlFake, { mode: 0o755 });

function run(name, extra = {}) {
  const caseRoot = path.join(temp, name);
  fs.mkdirSync(caseRoot);
  const log = path.join(caseRoot, 'calls.jsonl');
  const marker = path.join(caseRoot, 'deleted');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLOUDFLARE_API_TOKEN: 'test-token',
    SNAPBACK_CF_APP: 'notes',
    SNAPBACK_DEPLOY_PROBE_URL: 'https://proof.invalid',
    SNAPBACK_DEPLOY_PROBE_ATTEMPTS: '1',
    SNAPBACK_DEPLOY_PROBE_DELAY_SECONDS: '0',
    MOCK_LOG: log,
    MOCK_DELETED_MARKER: marker,
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
  return { ...result, output: `${result.stdout}${result.stderr}`, calls };
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

try {
  const existing = run('all-existing');
  assert.equal(existing.status, 0, existing.output);
  assert.deepEqual(deployConfigs(existing, true), []);
  assert.match(existing.output, /remote state: verified ABSENT/);

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

  // Failure on the second bootstrap must remove the first newly created
  // Worker; failures in each later stage must remove every bootstrap Worker.
  const bootstrapFailure = run('bootstrap-failure', { MOCK_EXISTING: '', MOCK_FAIL_DEPLOY_MATCH: 'wrangler.jsonc' });
  assert.notEqual(bootstrapFailure.status, 0);
  assert.deepEqual(deletedConfigs(bootstrapFailure), ['wrangler.handler.jsonc']);

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
  assert.deepEqual(deletedConfigs(staleHealth), []);

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

  console.log('cloudflare deploy-script acceptance: mixed bootstrap, rollback, and admin-secret states passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
