#!/usr/bin/env node

// Output from this generator must remain accepted by
// validateClosedLatestProofPlan in snapback-promotion-core.mjs.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BARRIER_STABILITY_RESERVE_MS,
  CURRENT_LEASE_SCHEMA_VERSION,
  LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS,
  LEASE_LIFETIME_MS,
  MODELED_TAG_MOVE_PHASE_MS,
  PROMOTION_ROLLBACK_RESERVE_MS,
  leaseSha256,
  validateClosedLatestProofPlan,
} from './snapback-promotion-core.mjs';
import {
  readBoundedJsonFile,
  sha256File,
  validateCandidateLedger,
} from './snapback-publish-core.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const latestProofHelper = resolve(
  repositoryRoot,
  'scripts/snapback-github-latest-proof.mjs',
);
const DEFAULT_DISPATCH_TIMEOUT_MS = 400_000;

const usage = `usage: node scripts/snapback-generate-latest-proof-plan.mjs
  --lease <authorized-lease.json>
  --ledger <candidate-ledger.json>
  --out <latest-proof-plan.json>
  [--ref <git-ref>] [--repository <owner/repo>] [--workflow <file.yml>]
  [--dispatch-timeout-ms <n>] [--verify-timeout-ms <n>]
  [--darwin-receipt <relative-path>] [--linux-receipt <relative-path>]
  [--collection <relative-path>]

Builds closed data for validateClosedLatestProofPlan. The current checkout
must be tracked-clean, and the ledger must be inside the repository root.`;

function fail(message, code = 1) {
  process.stderr.write(`snapback-generate-latest-proof-plan: ${message}\n`);
  process.exitCode = code;
}

function parseInteger(value, option) {
  if (!/^\d+$/u.test(value ?? '')) {
    throw new Error(`${option} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${option} must be a safe integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    collection: 'proof/collection.json',
    darwinReceipt: 'proof/darwin.json',
    dispatchTimeoutMs: DEFAULT_DISPATCH_TIMEOUT_MS,
    linuxReceipt: 'proof/linux.json',
    ref: 'main',
    repository: 'expo/snapback',
    verifyTimeoutMs: 30_000,
    workflow: 'public-package-proof.yml',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      throw new Error(`${argument} requires a value\n${usage}`);
    }
    if (argument === '--lease') options.lease = resolve(value);
    else if (argument === '--ledger') options.ledger = resolve(value);
    else if (argument === '--out') options.out = resolve(value);
    else if (argument === '--ref') options.ref = value;
    else if (argument === '--repository') options.repository = value;
    else if (argument === '--workflow') options.workflow = value;
    else if (argument === '--dispatch-timeout-ms') {
      options.dispatchTimeoutMs = parseInteger(value, argument);
    } else if (argument === '--verify-timeout-ms') {
      options.verifyTimeoutMs = parseInteger(value, argument);
    } else if (argument === '--darwin-receipt') options.darwinReceipt = value;
    else if (argument === '--linux-receipt') options.linuxReceipt = value;
    else if (argument === '--collection') options.collection = value;
    else throw new Error(`unknown argument ${argument}\n${usage}`);
  }
  for (const field of ['lease', 'ledger', 'out']) {
    if (!options[field]) throw new Error(`--${field} is required\n${usage}`);
  }
  return options;
}

function normalizedRelativePath(value, label) {
  if (
    typeof value !== 'string'
    || value === ''
    || value.startsWith('/')
    || value.includes('\\')
    || posix.normalize(value) !== value
    || value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a normalized relative POSIX path`);
  }
  return value;
}

function ledgerPathUnderRoot(root, ledgerFile) {
  const rootAbsolute = resolve(root);
  const ledgerAbsolute = resolve(rootAbsolute, ledgerFile);
  const value = relative(rootAbsolute, ledgerAbsolute).replaceAll('\\', '/');
  if (value === '' || value === '..' || value.startsWith('../')) {
    throw new Error('candidate ledger path must be inside the repository root');
  }
  return normalizedRelativePath(value, 'candidate ledger path');
}

function requireModeledPublicationLeaseBudget({
  dispatchTimeoutMs,
  verifyTimeoutMs,
}) {
  if (
    !Number.isSafeInteger(dispatchTimeoutMs)
    || !Number.isSafeInteger(verifyTimeoutMs)
  ) {
    return;
  }
  const totalMs =
    dispatchTimeoutMs
    + verifyTimeoutMs
    + PROMOTION_ROLLBACK_RESERVE_MS
    + BARRIER_STABILITY_RESERVE_MS
    + MODELED_TAG_MOVE_PHASE_MS;
  if (totalMs > LEASE_LIFETIME_MS) {
    throw new Error(
      'latest-proof plan modeled publication lease budget cannot close: '
        + `dispatchTimeoutMs=${dispatchTimeoutMs} + `
        + `verifyTimeoutMs=${verifyTimeoutMs} + `
        + `PROMOTION_ROLLBACK_RESERVE_MS=${PROMOTION_ROLLBACK_RESERVE_MS} + `
        + `BARRIER_STABILITY_RESERVE_MS=${BARRIER_STABILITY_RESERVE_MS} + `
        + `MODELED_TAG_MOVE_PHASE_MS=${MODELED_TAG_MOVE_PHASE_MS} = `
        + `${totalMs} > LEASE_LIFETIME_MS=${LEASE_LIFETIME_MS}`,
    );
  }
}

/**
 * Build the closed plan consumed by validateClosedLatestProofPlan.
 *
 * @ref LLP 0041#retained-comparator-evidence-hardening — the final hosted
 * proof is closed data bound to the lease, checkout, helper, and candidate.
 */
export function buildLatestProofPlan({
  lease,
  ledger,
  ledgerFile,
  repositoryRoot: root,
  expectedHeadSha,
  helperSha256,
  now = Date.now(),
  ref = 'main',
  repository = 'expo/snapback',
  workflow = 'public-package-proof.yml',
  dispatchTimeoutMs = DEFAULT_DISPATCH_TIMEOUT_MS,
  verifyTimeoutMs = 30_000,
  darwinReceipt = 'proof/darwin.json',
  linuxReceipt = 'proof/linux.json',
  collection = 'proof/collection.json',
}) {
  requireModeledPublicationLeaseBudget({ dispatchTimeoutMs, verifyTimeoutMs });
  validateCandidateLedger(ledger);
  const issuedAt = Date.parse(lease?.issuedAt ?? '');
  const expiresAt = Date.parse(lease?.expiresAt ?? '');
  if (
    lease?.schemaVersion !== CURRENT_LEASE_SCHEMA_VERSION
    || !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > LEASE_LIFETIME_MS
  ) {
    throw new Error('authorized lease has an unsupported generation or lifetime');
  }
  // Same bounded authority-ahead skew allowance as validatePublicationLease:
  // plan generation can run within milliseconds of issuance, so the local
  // clock may still trail the authority's issuedAt stamp. Expiry stays strict.
  if (
    !Number.isFinite(now)
    || now < issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS
    || now >= expiresAt
  ) {
    throw new Error('authorized lease is not current');
  }
  if (lease?.candidateLedgerSha256 !== ledger.candidateLedgerSha256) {
    throw new Error('authorized lease is not bound to the candidate ledger');
  }
  const cliLeaseRow = lease?.packages?.find(
    (row) => row.name === '@expo/snapback-cli',
  );
  if (!cliLeaseRow) {
    throw new Error('latest-root proof has no @expo/snapback-cli lease row');
  }
  if (cliLeaseRow.expectedPriorVersion === null) {
    throw new Error('latest-root proof has no signed prior CLI root version');
  }
  if (cliLeaseRow.expectedPriorVersion === cliLeaseRow.newVersion) {
    throw new Error('latest-root proof requires a prior CLI root distinct from the new version');
  }

  const ledgerPath = ledgerPathUnderRoot(root, ledgerFile);
  const plan = {
    schemaVersion: 'snapback.latest-root-proof-plan.v3',
    authorizedLeaseSha256: leaseSha256(lease),
    repository,
    workflow,
    ref,
    expectedHeadSha,
    expectedPriorRootVersion: cliLeaseRow.expectedPriorVersion,
    ledgerPath,
    operationId: lease.operationId,
    publicationEpoch: lease.publicationEpoch,
    helperSha256,
    darwinReceipt: normalizedRelativePath(darwinReceipt, 'darwin receipt path'),
    linuxReceipt: normalizedRelativePath(linuxReceipt, 'linux receipt path'),
    collection: normalizedRelativePath(collection, 'collection path'),
    dispatchTimeoutMs,
    verifyTimeoutMs,
  };
  return validateClosedLatestProofPlan({
    plan,
    expectedOperationId: lease.operationId,
    expectedHelperSha256: helperSha256,
    expectedLedgerPath: ledgerPath,
    expectedHeadSha,
    expectedPriorRootVersion: cliLeaseRow.expectedPriorVersion,
    expectedAuthorizedLeaseSha256: leaseSha256(lease),
    expectedPublicationEpoch: lease.publicationEpoch,
  });
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

export function writeLatestProofPlan({ out, ...inputs }) {
  const plan = buildLatestProofPlan(inputs);
  writeJsonAtomic(out, plan);
  return plan;
}

function resolveCleanHeadSha(root) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
  }).trim();
  const dirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: root, encoding: 'utf8', timeout: 10_000 },
  );
  if (dirty.length > 0) {
    throw new Error('latest-root proof helper checkout has tracked changes');
  }
  return head;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const lease = readBoundedJsonFile(options.lease, 'authorized publication lease');
  const ledger = readBoundedJsonFile(options.ledger, 'candidate publication ledger');
  const plan = writeLatestProofPlan({
    ...options,
    lease,
    ledger,
    ledgerFile: options.ledger,
    repositoryRoot,
    expectedHeadSha: resolveCleanHeadSha(repositoryRoot),
    helperSha256: sha256File(latestProofHelper),
    now: Date.now(),
  });
  process.stdout.write(`${JSON.stringify({
    out: options.out,
    operationId: plan.operationId,
    publicationEpoch: plan.publicationEpoch,
  })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    fail(error.message);
  }
}
