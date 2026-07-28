#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  buildPostPromotionLedger,
  canonicalJcs,
  publicationAuthorityTransition,
  promoteDefaultVector,
  sha256Hex,
  validatePublicationLease,
  validatePublicationAuthorityReceipt,
} from './snapback-promotion-core.mjs';
import {
  sha256File,
  validateCandidateLedger,
} from './snapback-publish-core.mjs';
import {
  validateFinalLatestReceipts,
} from './snapback-package-cold-install-lib.mjs';

const registry = 'https://registry.npmjs.org';
const usage = `usage: node scripts/snapback-promote.mjs
  --ledger <candidate-ledger.json> --lease <authorized-lease.json>
  --public-key <ed25519-public-key.pem>
  --lease-acquire-url <https-url> --lease-head-url <https-url>
  --lease-close-url <https-url> --publisher-instance <id>
  --latest-proof-plan <plan.json> --post-ledger <ledger.json>
  --out <promotion-receipt.json> [--otp <code>]

Default-tag promotion is always a real registry operation. It requires
SNAPBACK_PUBLISH_CONFIRM=yes-really and an externally authorized, current
publication lease. SNAPBACK_PUBLICATION_LEASE_TOKEN may carry a bearer token
for the external authority endpoints. The proof plan contains two bounded,
argv-only commands which produce fresh macOS/arm64 and Linux/x64 latest-root
receipts after the tag vector moves. Any proof or authority-close failure
enters the same strict reverse-order rollback path.`;

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
    else if (arg === '--lease-acquire-url') options.leaseAcquireUrl = value;
    else if (arg === '--lease-close-url') options.leaseCloseUrl = value;
    else if (arg === '--publisher-instance') options.publisherInstanceId = value;
    else if (arg === '--latest-proof-plan') options.latestProofPlan = resolve(value);
    else if (arg === '--post-ledger') options.postLedger = resolve(value);
    else if (arg === '--out') options.out = resolve(value);
    else if (arg === '--otp') options.otp = value;
    else fail(`unknown argument ${arg}\n${usage}`, 2);
  }
  for (const field of [
    'ledger',
    'lease',
    'publicKey',
    'leaseHeadUrl',
    'leaseAcquireUrl',
    'leaseCloseUrl',
    'publisherInstanceId',
    'latestProofPlan',
    'postLedger',
    'out',
  ]) {
    if (!options[field]) fail(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required\n${usage}`, 2);
  }
  for (const field of ['leaseHeadUrl', 'leaseAcquireUrl', 'leaseCloseUrl']) {
    let url;
    try {
      url = new URL(options[field]);
    } catch {
      fail(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} must be an absolute HTTPS URL`, 2);
    }
    if (url.protocol !== 'https:') {
      fail(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} must use HTTPS`, 2);
    }
    options[field] = url.href;
  }
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

const options = parseArgs(process.argv.slice(2));
if (process.env.SNAPBACK_PUBLISH_CONFIRM !== 'yes-really') {
  fail('real promotion requires SNAPBACK_PUBLISH_CONFIRM=yes-really');
}

const ledger = JSON.parse(readFileSync(options.ledger, 'utf8'));
try {
  validateCandidateLedger(ledger);
} catch (error) {
  fail(`candidate ledger refused: ${error.message}`);
}
const candidateLedgerSha256 = ledger.candidateLedgerSha256;

const lease = JSON.parse(readFileSync(options.lease, 'utf8'));
validatePublicationLease({
  lease,
  publicKey: readFileSync(options.publicKey),
  candidateLedgerSha256,
  candidateTag: ledger.tag,
  publisherInstanceId: options.publisherInstanceId,
});
const candidatesByName = new Map(ledger.packages.map((row) => [row.name, row]));
for (const row of lease.packages) {
  const candidate = candidatesByName.get(row.name);
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

function authorityHeaders() {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  const token = process.env.SNAPBACK_PUBLICATION_LEASE_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function transitionAuthority(url, transition) {
  const response = await fetch(url, {
    method: 'POST',
    headers: authorityHeaders(),
    body: canonicalJcs(transition),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`external publication authority returned HTTP ${response.status}`);
  }
  return validatePublicationAuthorityReceipt({
    receipt: await response.json(),
    transition,
  });
}

function loadLatestProofPlan() {
  const plan = JSON.parse(readFileSync(options.latestProofPlan, 'utf8'));
  const keys = Object.keys(plan).sort();
  if (
    keys.join(',') !== 'commands,schemaVersion'
    || plan.schemaVersion !== 'snapback.latest-root-proof-plan.v1'
    || !Array.isArray(plan.commands)
    || plan.commands.length !== 2
  ) {
    throw new Error('latest-root proof plan must be a closed two-command plan');
  }
  const platforms = ['darwin-arm64', 'linux-x64'];
  for (const [index, command] of plan.commands.entries()) {
    if (
      Object.keys(command).sort().join(',') !== 'args,command,platform,receipt,timeoutMs'
      || command.platform !== platforms[index]
      || typeof command.command !== 'string'
      || command.command.length === 0
      || !Array.isArray(command.args)
      || command.args.some((value) => typeof value !== 'string')
      || typeof command.receipt !== 'string'
      || !Number.isSafeInteger(command.timeoutMs)
      || command.timeoutMs < 1_000
      || command.timeoutMs > 600_000
    ) {
      throw new Error(`invalid latest-root proof command ${index}`);
    }
  }
  if (plan.commands.reduce((total, command) => total + command.timeoutMs, 0) > 8 * 60_000) {
    throw new Error('latest-root proof plan exceeds the publication-lease time budget');
  }
  return plan;
}

function executeLatestProofPlan() {
  const plan = loadLatestProofPlan();
  const records = [];
  for (const command of plan.commands) {
    const result = spawnSync(command.command, command.args, {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: command.timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(
        `latest-root ${command.platform} proof command failed with ${result.status ?? result.signal ?? 'unknown'}`,
      );
    }
    const path = resolve(dirname(options.latestProofPlan), command.receipt);
    if (!existsSync(path)) {
      throw new Error(`latest-root ${command.platform} proof omitted its receipt`);
    }
    records.push({
      path,
      sha256: sha256File(path),
      receipt: JSON.parse(readFileSync(path, 'utf8')),
    });
  }
  return validateFinalLatestReceipts({ ledger, records });
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

let authorityAcquired = false;
try {
  const priorVector = Object.fromEntries(lease.packages.map((row) => [
    row.name,
    row.expectedPriorVersion,
  ]));
  const acquisition = publicationAuthorityTransition({
    lease,
    outcome: 'acquired',
    vector: priorVector,
  });
  receipt.authorityAcquisition = await transitionAuthority(
    options.leaseAcquireUrl,
    acquisition,
  );
  authorityAcquired = true;
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
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
    async afterPromotion({ vector, events }) {
      const latestRootReceipts = executeLatestProofPlan();
      validatePublicationLease({
        lease,
        publicKey: readFileSync(options.publicKey),
        candidateLedgerSha256,
        candidateTag: ledger.tag,
        publisherInstanceId: options.publisherInstanceId,
      });
      const postLedger = buildPostPromotionLedger({
        candidateLedger: ledger,
        lease,
        events,
        vector,
        latestRootReceipts,
      });
      mkdirSync(dirname(options.postLedger), { recursive: true });
      writeFileSync(
        options.postLedger,
        `${JSON.stringify(postLedger, null, 2)}\n`,
        { mode: 0o600 },
      );
      const closure = publicationAuthorityTransition({
        lease,
        outcome: 'promoted',
        vector,
        publicationLedgerSha256: postLedger.postPromotionLedgerSha256,
      });
      const authorityClosure = await transitionAuthority(options.leaseCloseUrl, closure);
      return {
        postPromotionLedger: options.postLedger,
        postPromotionLedgerSha256: postLedger.postPromotionLedgerSha256,
        latestRootReceipts,
        authorityClosure,
      };
    },
  });
  receipt.status = 'promoted-and-closed';
  receipt.finalVector = result.vector;
  receipt.finalization = result.finalization;
} catch (error) {
  receipt.status = 'failed';
  receipt.failure = error.message;
  receipt.finalVector = error.result?.vector ?? null;
  receipt.rollback = error.result?.rollback ?? [];
  if (authorityAcquired) {
    const priorVector = Object.fromEntries(lease.packages.map((row) => [
      row.name,
      row.expectedPriorVersion,
    ]));
    if (canonicalJcs(receipt.finalVector) === canonicalJcs(priorVector)) {
      try {
        const rollbackClosure = publicationAuthorityTransition({
          lease,
          outcome: 'rolled-back',
          vector: priorVector,
        });
        receipt.authorityRollbackClosure = await transitionAuthority(
          options.leaseCloseUrl,
          rollbackClosure,
        );
      } catch (closeError) {
        receipt.authorityRollbackClosure = {
          closed: false,
          error: closeError.message,
        };
      }
    }
  }
  receipt.finishedAt = new Date().toISOString();
  receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  fail(`promotion failed; retained receipt ${options.out}`);
}

receipt.finishedAt = new Date().toISOString();
receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(`promoted and externally closed nine-package default vector; receipt: ${options.out}`);
