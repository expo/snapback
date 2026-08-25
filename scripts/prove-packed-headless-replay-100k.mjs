#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Full local scale proof for LLP 0307.000 Acceptance 1. This is intentionally
// separate from the 2,000-action CI test: settle-before-next makes 200,000
// protocol-v1 mutations a qualification run, not a landing-fast unit test.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = [...process.argv.slice(2)];
const take = (name, fallback = null) => {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  assert(value && !value.startsWith('-'), `${name} requires a value`);
  argv.splice(index, 2);
  return value;
};
const readyFile = resolve(take('--ready-file'));
const api = resolve(take('--api'));
const actions = resolve(take('--actions'));
const backendDirectory = resolve(take('--backend-dir', dirname(dirname(api))));
const rssBudgetMiB = Number(take('--rss-mib', '512'));
assert.equal(argv.length, 0, `unknown arguments: ${argv.join(' ')}`);
assert(Number.isSafeInteger(rssBudgetMiB) && rssBudgetMiB > 0, '--rss-mib must be a positive integer');

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-packed-replay-100k-')));
const tarballs = join(scratch, 'tarballs');
const consumer = join(scratch, 'consumer');
const npmCache = join(scratch, 'npm-cache');
const stageRoot = join(scratch, 'stage');
mkdirSync(tarballs, { recursive: true });
mkdirSync(consumer, { recursive: true });
mkdirSync(stageRoot, { recursive: true });

const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  cwd: options.cwd ?? repoRoot,
  env: { ...process.env, ...(options.env ?? {}) },
  maxBuffer: 32 * 1024 * 1024,
});

const internalVersions = new Map();
for (const entry of readdirSync(join(repoRoot, 'packages'))) {
  const manifestPath = join(repoRoot, 'packages', entry, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
    internalVersions.set(manifest.name, manifest.version);
  }
}

function pack(packageDirectory) {
  const source = resolve(repoRoot, packageDirectory);
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const staged = join(stageRoot, packageDirectory.split('/').at(-1));
  mkdirSync(staged, { recursive: true });
  for (const entry of manifest.files ?? []) {
    const from = join(source, entry);
    if (existsSync(from)) {
      cpSync(from, join(staged, entry), { recursive: true });
      continue;
    }
    // The publication path prepares this ignored closure before staging. Keep
    // the proof worktree-pure by constructing the same closure in its stage.
    if (manifest.name === '@expo/snapback-codegen' && entry === 'runtime-artifacts') {
      mkdirSync(join(staged, entry, 'tests', 'conformance'), { recursive: true });
      cpSync(join(repoRoot, 'schemas'), join(staged, entry, 'schemas'), { recursive: true });
      cpSync(
        join(repoRoot, 'tests', 'conformance', 'data-tier'),
        join(staged, entry, 'tests', 'conformance', 'data-tier'),
        { recursive: true },
      );
      continue;
    }
    assert.fail(`${manifest.name} files entry is missing: ${entry}`);
  }
  for (const section of [
    'dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies',
  ]) {
    for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
      if (!/^(?:workspace:|file:|link:)/u.test(String(value))) continue;
      const version = internalVersions.get(dependency);
      assert(version, `${manifest.name}.${section}.${dependency} is not an internal package`);
      manifest[section][dependency] = version;
    }
  }
  delete manifest.scripts;
  writeFileSync(join(staged, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const output = run('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', tarballs,
  ], { cwd: staged, env: { npm_config_cache: npmCache } });
  const metadata = JSON.parse(output);
  assert.equal(metadata.length, 1, `${packageDirectory} produced one npm archive`);
  return join(tarballs, metadata[0].filename);
}

try {
  const archives = [
    'packages/snapback-contract',
    'packages/snapback-client',
    'packages/snapback-codegen',
    'packages/snapback-react',
    'packages/snapback-acceptance',
    'packages/snapback-cli',
  ].map(pack);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  // npm installs the package names declared inside each archive.
  run('npm', [
    'install', '--ignore-scripts', '--package-lock=false', ...archives,
  ], { cwd: consumer, env: { npm_config_cache: npmCache } });

  const runner = join(consumer, 'run-proof.mjs');
  writeFileSync(runner, `
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { runCli } from '@expo/snapback-cli';

const actions = process.env.REPLAY_ACTIONS;
let count = 0;
const actors = new Set();
for await (const line of createInterface({input:createReadStream(actions), crlfDelay:Infinity})) {
  if (!line.trim()) continue;
  const action = JSON.parse(line);
  count += 1; actors.add(action.actor);
}
assert(count >= 100_000, 'packed proof requires at least 100,000 actions');
assert(actors.size >= 8, 'packed proof requires at least eight personas');
const helperSource = readFileSync(join(process.cwd(), 'node_modules/@expo/snapback-acceptance/replay.mjs'), 'utf8');
assert.equal(helperSource.includes('.subscribeLive('), false, 'replay helper has no live subscription path');
assert.equal(helperSource.includes('.liveQuery('), false, 'replay helper has no live-query path');

let peakRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
const nativeFetch = globalThis.fetch;
let liveQueryRegistrations = 0;
globalThis.fetch = (input, init) => {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
  if (typeof raw === 'string') {
    const pathname = new URL(raw, 'http://snapback.invalid').pathname;
    if (/^\\/live\\/[^/]+\\/subscribe$/u.test(pathname)) liveQueryRegistrations += 1;
  }
  return nativeFetch(input, init);
};
const receipts = [];
try {
  for (const custody of ['minted', 'none']) {
    const stdout = [];
    const savedLog = console.log;
    const savedError = console.error;
    console.log = (...values) => stdout.push(values.join(' '));
    console.error = () => {};
    let exitCode;
    try {
      exitCode = await runCli([
        'replay', process.env.REPLAY_BACKEND,
        '--actions', actions,
        '--api', process.env.REPLAY_API,
        '--ready-file', process.env.REPLAY_READY,
        '--receipts', join(process.cwd(), custody + '-receipts.jsonl'),
        '--status-file', join(process.cwd(), custody + '-status.json'),
        '--custody', custody,
        '--json',
      ], {cwd: process.cwd()});
    } finally {
      console.log = savedLog; console.error = savedError;
    }
    assert.equal(stdout.length, 1, custody + ' emitted one JSON document');
    const receipt = JSON.parse(stdout[0]);
    assert.equal(exitCode, 0, JSON.stringify(receipt.diagnostic));
    assert.equal(receipt.actions.settled, count);
    assert(receipt.pool.maximumObserved <= receipt.pool.configured);
    assert.notEqual(receipt.diagnostic?.code, 'SNAPBACK_CLIENT_MUTATION_RETENTION_FULL');
    receipts.push(receipt);
  }
} finally {
  clearInterval(sampler);
  globalThis.fetch = nativeFetch;
}
assert(peakRss <= Number(process.env.REPLAY_RSS_BUDGET_BYTES), 'RSS exceeded fixed proof budget');
assert.equal(liveQueryRegistrations, 0, 'replay registered a live query at runtime');
const receiptDigest = createHash('sha256').update(JSON.stringify(receipts)).digest('hex');
process.stdout.write(JSON.stringify({
  schemaVersion:'snapback.packed-headless-replay-proof.v1', actions:count,
  personas:actors.size, custodyPolicies:['minted','none'], peakRss,
  rssBudgetBytes:Number(process.env.REPLAY_RSS_BUDGET_BYTES), receiptDigest,
  liveQueryRegistrations,
  liveQueryRegistrationObservation:'runtime-fetch-boundary',
  receipts:receipts.map((receipt) => ({
    status:receipt.status, custody:receipt.custody, pool:receipt.pool,
    acknowledgement:receipt.acknowledgement,
  })),
}) + '\\n');
`);
  const output = run(process.execPath, [runner], {
    cwd: consumer,
    env: {
      REPLAY_READY: readyFile,
      REPLAY_API: api,
      REPLAY_ACTIONS: actions,
      REPLAY_BACKEND: backendDirectory,
      REPLAY_RSS_BUDGET_BYTES: String(rssBudgetMiB * 1_024 * 1_024),
      SNAPBACK_RUNTIME_BINARY: process.env.SNAPBACK_RUNTIME_BINARY
        ?? join(repoRoot, 'target', 'debug', 'snapback'),
    },
  });
  process.stdout.write(output);
} finally {
  if (process.env.SNAPBACK_KEEP_PACKED_REPLAY_SCRATCH === '1') {
    process.stderr.write(`packed replay scratch preserved at ${scratch}\n`);
  } else {
    rmSync(scratch, { recursive: true, force: true });
  }
}
