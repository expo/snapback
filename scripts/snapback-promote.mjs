#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  canonicalJcs,
  promoteDefaultVector,
  sha256Hex,
  validatePublicationLease,
} from './snapback-promotion-core.mjs';

const registry = 'https://registry.npmjs.org';
const usage = `usage: node scripts/snapback-promote.mjs
  --ledger <candidate-ledger.json> --lease <authorized-lease.json>
  --public-key <ed25519-public-key.pem> --lease-head-url <https-url>
  --publisher-instance <id> --out <promotion-receipt.json> [--otp <code>]

Default-tag promotion is always a real registry operation. It requires
SNAPBACK_PUBLISH_CONFIRM=yes-really and an externally authorized, current
publication lease. SNAPBACK_PUBLICATION_LEASE_TOKEN may carry a bearer token
for the external read-only lease-head endpoint.`;

function fail(message, code = 1) {
  console.error(`snapback-promote: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = { otp: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage);
      process.exit(0);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`${arg} requires a value\n${usage}`, 2);
    if (arg === '--ledger') options.ledger = resolve(value);
    else if (arg === '--lease') options.lease = resolve(value);
    else if (arg === '--public-key') options.publicKey = resolve(value);
    else if (arg === '--lease-head-url') options.leaseHeadUrl = value;
    else if (arg === '--publisher-instance') options.publisherInstanceId = value;
    else if (arg === '--out') options.out = resolve(value);
    else if (arg === '--otp') options.otp = value;
    else fail(`unknown argument ${arg}\n${usage}`, 2);
  }
  for (const field of [
    'ledger',
    'lease',
    'publicKey',
    'leaseHeadUrl',
    'publisherInstanceId',
    'out',
  ]) {
    if (!options[field]) fail(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required\n${usage}`, 2);
  }
  let headUrl;
  try {
    headUrl = new URL(options.leaseHeadUrl);
  } catch {
    fail('--lease-head-url must be an absolute HTTPS URL', 2);
  }
  if (headUrl.protocol !== 'https:') fail('--lease-head-url must use HTTPS', 2);
  options.leaseHeadUrl = headUrl.href;
  return options;
}

function runNpm(args) {
  const result = spawnSync('npm', [...args, '--registry', registry], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed with ${result.status ?? result.signal ?? 'unknown'}`);
  }
  return result.stdout;
}

function ledgerWithoutDigest(ledger) {
  const { candidateLedgerSha256: _digest, ...unsigned } = ledger;
  return unsigned;
}

const options = parseArgs(process.argv.slice(2));
if (process.env.SNAPBACK_PUBLISH_CONFIRM !== 'yes-really') {
  fail('real promotion requires SNAPBACK_PUBLISH_CONFIRM=yes-really');
}

const ledger = JSON.parse(readFileSync(options.ledger, 'utf8'));
if (ledger.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    || ledger.mode !== 'publish'
    || ledger.registry !== registry
    || ledger.scopePreset !== 'ccheever'
    || !Array.isArray(ledger.packages)
    || ledger.packages.length !== 9) {
  fail('candidate ledger is not a complete public @ccheever publication ledger');
}
const candidateLedgerSha256 = sha256Hex(canonicalJcs(ledgerWithoutDigest(ledger)));
if (ledger.candidateLedgerSha256 !== candidateLedgerSha256) {
  fail('candidate ledger self-digest mismatch');
}

const lease = JSON.parse(readFileSync(options.lease, 'utf8'));
validatePublicationLease({
  lease,
  publicKey: readFileSync(options.publicKey),
  candidateLedgerSha256,
  candidateTag: ledger.tag,
  publisherInstanceId: options.publisherInstanceId,
});
for (const [index, row] of lease.packages.entries()) {
  const candidate = ledger.packages[index];
  if (candidate?.name !== row.name
      || candidate.version !== row.newVersion
      || candidate.registrySha256 !== candidate.sha256) {
    fail(`lease package ${row.name} is not identically bound to candidate ledger order`);
  }
}

async function readVector(names) {
  const vector = {};
  for (const name of names) {
    const output = runNpm(['view', name, 'dist-tags', '--json']);
    const tags = output.trim() ? JSON.parse(output) : {};
    vector[name] = Object.hasOwn(tags, lease.defaultTag) ? tags[lease.defaultTag] : null;
  }
  return vector;
}

async function preflightPriorDefaultClosure() {
  const names = lease.packages.map((row) => row.name);
  const expected = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const observed = await readVector(names);
  if (names.some((name) => (observed[name] ?? null) !== expected[name])) {
    throw new Error('prior default-tag vector does not match the authorized lease');
  }

  const selected = new Map(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const temporaryRoot = mkdtempSync(join(dirname(options.out), '.snapback-prior-'));
  const packages = [];
  try {
    for (const row of lease.packages) {
      if (row.expectedPriorVersion === null) {
        packages.push({ name: row.name, version: null, status: 'absent' });
        continue;
      }
      const packed = JSON.parse(runNpm([
        'pack',
        `${row.name}@${row.expectedPriorVersion}`,
        '--pack-destination',
        temporaryRoot,
        '--json',
        '--ignore-scripts',
      ]))[0];
      const tarball = join(temporaryRoot, packed.filename);
      const manifest = JSON.parse(execFileSync(
        'tar',
        ['-xzOf', tarball, 'package/package.json'],
        { encoding: 'utf8' },
      ));
      if (manifest.name !== row.name || manifest.version !== row.expectedPriorVersion) {
        throw new Error(`prior registry identity drift for ${row.name}`);
      }
      const dependencyAliases = [];
      for (const section of ['dependencies', 'optionalDependencies']) {
        for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
          if (/^(?:workspace:|file:|link:)/.test(String(value))) {
            throw new Error(`prior ${row.name} contains non-registry ${section}.${dependency}`);
          }
          const match = String(value).match(
            /^npm:(@ccheever\/snapback-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
          );
          if (String(value).includes('@ccheever/snapback-') && !match) {
            throw new Error(`prior ${row.name} contains non-exact Snapback alias ${section}.${dependency}`);
          }
          if (!match) continue;
          const [, target, version] = match;
          if (!selected.has(target) || selected.get(target) !== version) {
            throw new Error(`prior ${row.name} alias ${target}@${version} escapes the authorized vector`);
          }
          dependencyAliases.push({ section, dependency, target, version });
        }
      }
      packages.push({
        name: row.name,
        version: row.expectedPriorVersion,
        tarballSha256: sha256Hex(readFileSync(tarball)),
        dependencyAliases,
        status: 'verified',
      });
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
  return { observedVector: observed, packages };
}

async function readLeaseHead() {
  const headers = { accept: 'application/json' };
  const token = process.env.SNAPBACK_PUBLICATION_LEASE_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(options.leaseHeadUrl, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`external lease head returned HTTP ${response.status}`);
  return response.json();
}

async function setTag(name, version) {
  const args = ['dist-tag', 'add', `${name}@${version}`, lease.defaultTag];
  if (options.otp) args.push('--otp', options.otp);
  runNpm(args);
}

async function removeTag(name) {
  const args = ['dist-tag', 'rm', name, lease.defaultTag];
  if (options.otp) args.push('--otp', options.otp);
  runNpm(args);
}

const receipt = {
  schemaVersion: 'snapback.package-promotion-receipt.v1',
  previousLedgerSha256: candidateLedgerSha256,
  operationId: lease.operationId,
  publicationEpoch: lease.publicationEpoch,
  publisherInstanceId: lease.publisherInstanceId,
  candidateTag: lease.candidateTag,
  defaultTag: lease.defaultTag,
  startedAt: new Date().toISOString(),
  status: 'running',
  events: [],
};
mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });

try {
  receipt.priorDefaultClosurePreflight = await preflightPriorDefaultClosure();
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  const result = await promoteDefaultVector({
    lease,
    readVector,
    readLeaseHead,
    setTag,
    removeTag,
    record(event) {
      receipt.events.push(event);
      writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    },
  });
  receipt.status = 'promoted';
  receipt.finalVector = result.vector;
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = error.message;
  receipt.finalVector = error.result?.vector ?? null;
  receipt.rollback = error.result?.rollback ?? [];
  receipt.finishedAt = new Date().toISOString();
  receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fail(`promotion failed; retained receipt ${options.out}`);
}

receipt.finishedAt = new Date().toISOString();
receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`promoted nine-package default vector; receipt: ${options.out}`);
