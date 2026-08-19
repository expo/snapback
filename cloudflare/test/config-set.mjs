// ENG-24363: config material never enters argv, names/pool shapes are checked
// before write, and generation alone cannot falsely attest a partial write.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  attestApplied,
  buildBulkPayload,
  parseArgs,
  runWranglerBulk,
  validateRequestedEntries,
} from '../config-set.mjs';
import { resolveLockedWrangler } from '../locked-wrangler.mjs';

const status = {
  generation: 4,
  declarations: [
    { name: 'caltrainFeed', state: 'set', poolMembers: 2 },
    { name: 'directions', state: 'missing', poolMembers: 0 },
  ],
};
const encoded = validateRequestedEntries(status, { caltrainFeed: ['one', 'two'] });
assert.deepEqual(encoded, { caltrainFeed: '["one","two"]' });
assert.throws(() => validateRequestedEntries(status, { typo: ['secret'] }), /not declared/);
assert.throws(() => validateRequestedEntries(status, { directions: [] }), /nonempty array/);
assert.throws(() => validateRequestedEntries(status, { directions: ['ok', 4] }), /nonempty strings/);
assert.throws(() => parseArgs(['--entry', 'directions=["must-not-echo"]']), (error) => {
  assert.ok(!error.message.includes('must-not-echo'));
  return /refused/.test(error.message);
});
assert.equal(parseArgs(['--entries-stdin', '--url', 'https://example.invalid']).entriesStdin, true);
assert.equal(parseArgs(['--timeout-ms', '123', '--entries-stdin', '--url', 'https://example.invalid']).timeoutMs, 123);
assert.throws(() => parseArgs(['--timeout-ms', '0']), /positive integer/);
assert.throws(() => parseArgs(['--timeout-ms', '900001']), /no greater than 900000/);
assert.deepEqual(buildBulkPayload('all-aboard', encoded, 5), {
  SNAPBACK_SECRET_ALL_ABOARD_CALTRAIN_FEED: '["one","two"]',
  SNAPBACK_CONFIG_GENERATION: '5',
});

let correctMembers = false;
let sawAdminToken = false;
let hangStatus = false;
const server = http.createServer((request, response) => {
  sawAdminToken ||= request.headers['x-snapback-admin-token'] === 'operator-token';
  if (hangStatus) return;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    generation: 5,
    declarations: [{
      name: 'caltrainFeed',
      state: correctMembers ? 'set' : 'missing',
      poolMembers: correctMembers ? 2 : 0,
    }],
  }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = await attestApplied(base, 5, {
    adminToken: 'operator-token',
    expectedEntries: { caltrainFeed: ['one', 'two'] },
    timeoutMs: 80,
    intervalMs: 10,
  });
  assert.equal(pending, 'pending', 'generation without member state must not attest applied');
  correctMembers = true;
  const applied = await attestApplied(base, 5, {
    adminToken: 'operator-token',
    expectedEntries: { caltrainFeed: ['one', 'two'] },
    timeoutMs: 200,
    intervalMs: 10,
  });
  assert.equal(applied, 'applied');
  assert.equal(sawAdminToken, true);

  // A server that accepts the socket but never responds cannot outlive the
  // advertised overall deadline.
  hangStatus = true;
  const hungStarted = Date.now();
  const hung = await attestApplied(base, 6, {
    adminToken: 'operator-token',
    timeoutMs: 30,
    intervalMs: 5,
  });
  assert.equal(hung, 'pending');
  assert.ok(Date.now() - hungStarted < 500, 'hung status read must be aborted by the overall deadline');

  const cliSecret = 'config-input-must-never-print';
  const cli = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../config-set.mjs', import.meta.url)),
      '--url',
      base,
      '--entries-stdin',
      '--timeout-ms',
      '30',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, SNAPBACK_ADMIN_TOKEN: 'operator-token' },
      input: JSON.stringify({ directions: [cliSecret] }),
      timeout: 2_000,
      killSignal: 'SIGKILL',
    },
  );
  assert.equal(cli.status, 3, `${cli.stdout}${cli.stderr}`);
  assert.match(cli.stderr, /SNAPBACK_CONFIG_STATUS_UNKNOWN/);
  assert.doesNotMatch(`${cli.stdout}${cli.stderr}`, new RegExp(cliSecret));
  hangStatus = false;

  // Sleeping between healthy-but-not-applied reads is bounded by the same
  // deadline rather than by a full configured retry interval.
  correctMembers = false;
  const slowRetryStarted = Date.now();
  const slowRetry = await attestApplied(base, 6, {
    adminToken: 'operator-token',
    timeoutMs: 25,
    intervalMs: 5_000,
  });
  assert.equal(slowRetry, 'pending');
  assert.ok(Date.now() - slowRetryStarted < 500, 'retry sleep must respect the overall deadline');
} finally {
  server.close();
}

// A hung Wrangler child is force-killed within the remaining operation
// budget and classified as pending/unknown because remote activation may
// already have happened before the local timeout.
const childStarted = Date.now();
const childOutcome = runWranglerBulk(
  {
    command: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'],
  },
  { SNAPBACK_SECRET_TEST_VALUE: 'never-print-this' },
  'wrangler.test.jsonc',
  { deadlineMs: Date.now() + 40 },
);
assert.equal(childOutcome, 'timeout');
assert.ok(Date.now() - childStarted < 1_000, 'hung Wrangler must not outlive its operation deadline');
assert.equal(
  runWranglerBulk(
    { command: process.execPath, args: [] },
    {},
    'wrangler.test.jsonc',
    {
      deadlineMs: Date.now() + 1_000,
      spawnSyncImpl: () => ({ status: 7, error: undefined }),
    },
  ),
  'failed',
  'a nonzero child is pending/unknown because remote activation may precede local failure',
);

// The deployment controller resolves only the locally installed binary whose
// package version matches the explicit pin and bun.lock resolution.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'snapback-wrangler-preflight-'));
try {
  const cloudflare = path.join(fixture, 'cloudflare');
  const wranglerRoot = path.join(fixture, 'node_modules', 'wrangler');
  fs.mkdirSync(path.join(wranglerRoot, 'bin'), { recursive: true });
  fs.mkdirSync(cloudflare, { recursive: true });
  fs.writeFileSync(path.join(cloudflare, 'wrangler.lock.json'), '{"version":"4.108.0"}\n');
  fs.writeFileSync(path.join(fixture, 'bun.lock'), '{"packages":{"wrangler":["wrangler@4.108.0"]}}\n');
  fs.writeFileSync(
    path.join(wranglerRoot, 'package.json'),
    '{"version":"4.108.0","bin":{"wrangler":"bin/wrangler.js"}}\n',
  );
  fs.writeFileSync(path.join(wranglerRoot, 'bin', 'wrangler.js'), 'process.exit(0);\n');
  assert.equal(resolveLockedWrangler({ repoRoot: fixture }).version, '4.108.0');

  fs.writeFileSync(
    path.join(wranglerRoot, 'package.json'),
    '{"version":"4.109.0","bin":{"wrangler":"bin/wrangler.js"}}\n',
  );
  assert.throws(
    () => resolveLockedWrangler({ repoRoot: fixture }),
    /SNAPBACK_WRANGLER_PRECHECK_FAILED: installed Wrangler 4\.109\.0 does not match pinned 4\.108\.0/,
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('cloudflare config-set tests: locked Wrangler, bounded stdin apply, and deadline-bound attestation passed');
