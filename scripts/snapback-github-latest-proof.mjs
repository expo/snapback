#!/usr/bin/env node

// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — final
// latest-root evidence is one fresh, operation-correlated, GitHub-hosted
// matrix whose run and artifact identities are reopened through GitHub.

import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validatePublicationReceiptProvenance,
} from './snapback-publish-core.mjs';

export const LATEST_PROOF_REPOSITORY = 'ccheever/snapback';
export const LATEST_PROOF_WORKFLOW = 'public-package-proof.yml';
const COLLECTION_KEYS = [
  'artifacts',
  'collectedAt',
  'dispatchStartedAt',
  'expectedHeadSha',
  'ledgerRevision',
  'operationId',
  'ref',
  'repository',
  'runAttempt',
  'runCreatedAt',
  'runHeadSha',
  'runId',
  'runStartedAt',
  'schemaVersion',
  'workflow',
  'workflowId',
  'workflowPath',
];
const ARTIFACT_KEYS = [
  'apiDigest',
  'archiveSha256',
  'artifactId',
  'artifactName',
  'platform',
  'receiptFilename',
  'receiptSha256',
];
const usage = `usage:
  node scripts/snapback-github-latest-proof.mjs dispatch
    --repository ccheever/snapback --workflow public-package-proof.yml
    --ref <branch> --expected-head-sha <sha>
    --ledger-path <repo-relative-ledger.json> --operation-id <id>
    --darwin-receipt <path> --linux-receipt <path> --collection <path>
    [--timeout-ms <1000..450000>]

  node scripts/snapback-github-latest-proof.mjs verify-collection
    --repository ccheever/snapback --workflow public-package-proof.yml
    --ref <branch> --expected-head-sha <sha>
    --ledger-path <repo-relative-ledger.json> --operation-id <id>
    --darwin-receipt <path> --linux-receipt <path> --collection <path>
    [--timeout-ms <1000..30000>]`;

function fail(message) {
  throw new Error(`snapback-github-latest-proof: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} has unknown or missing members`);
  }
}

function parseArgs(argv) {
  const mode = argv[0];
  if (mode === '--help' || mode === '-h') return { help: true };
  if (!['dispatch', 'verify-collection'].includes(mode)) fail(`unknown mode\n${usage}`);
  const options = { mode, timeoutMs: mode === 'dispatch' ? 440_000 : 30_000 };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
    const key = {
      '--repository': 'repository',
      '--workflow': 'workflow',
      '--ref': 'ref',
      '--expected-head-sha': 'expectedHeadSha',
      '--ledger-path': 'ledgerPath',
      '--operation-id': 'operationId',
      '--darwin-receipt': 'darwinReceipt',
      '--linux-receipt': 'linuxReceipt',
      '--collection': 'collection',
      '--timeout-ms': 'timeoutMs',
    }[argument];
    if (!key) fail(`unknown argument ${argument}`);
    if (Object.hasOwn(options, key) && key !== 'timeoutMs') {
      fail(`duplicate argument ${argument}`);
    }
    options[key] = key === 'timeoutMs' ? Number(value) : value;
  }
  for (const key of [
    'repository',
    'workflow',
    'ref',
    'expectedHeadSha',
    'ledgerPath',
    'operationId',
    'darwinReceipt',
    'linuxReceipt',
    'collection',
  ]) {
    if (!options[key]) fail(`${mode} requires ${key}\n${usage}`);
  }
  if (options.repository !== LATEST_PROOF_REPOSITORY) {
    fail(`--repository must be ${LATEST_PROOF_REPOSITORY}`);
  }
  if (options.workflow !== LATEST_PROOF_WORKFLOW) {
    fail(`--workflow must be ${LATEST_PROOF_WORKFLOW}`);
  }
  if (!/^[A-Za-z0-9._/-]{1,200}$/u.test(options.ref) || options.ref.includes('..')) {
    fail('--ref is invalid');
  }
  if (!/^[0-9a-f]{40}$/u.test(options.expectedHeadSha)) {
    fail('--expected-head-sha must be one lowercase Git SHA');
  }
  if (
    options.ledgerPath.startsWith('/')
    || options.ledgerPath.split('/').some((part) => part === '..' || part === '')
  ) {
    fail('--ledger-path must be a normalized repository-relative path');
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(options.operationId)) {
    fail('--operation-id is invalid');
  }
  const maximum = mode === 'dispatch' ? 450_000 : 30_000;
  if (
    !Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 1_000
    || options.timeoutMs > maximum
  ) {
    fail(`--timeout-ms must be an integer in [1000, ${maximum}]`);
  }
  for (const key of ['darwinReceipt', 'linuxReceipt', 'collection']) {
    options[key] = resolve(options[key]);
  }
  return options;
}

function runGh(args, { binary = false, timeout = 30_000 } = {}) {
  const result = spawnSync('gh', args, {
    encoding: binary ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const diagnostic = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString('utf8')
      : result.stderr;
    fail(`gh ${args[0]} failed with ${result.status ?? result.signal ?? 'unknown'}: ${diagnostic}`);
  }
  return result.stdout;
}

function runGhJson(args) {
  try {
    return JSON.parse(runGh(args));
  } catch (error) {
    if (error.message.startsWith('snapback-github-latest-proof:')) throw error;
    fail(`gh ${args[0]} returned non-JSON output`);
  }
}

function writePrivateAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readLedgerRevision(options) {
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(resolve(options.ledgerPath), 'utf8'));
  } catch (error) {
    fail(`candidate ledger could not be read: ${error.message}`);
  }
  if (
    ledger?.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    || ledger.mode !== 'publish'
    || ledger.sourceDirty !== false
    || !/^[0-9a-f]{40}$/u.test(ledger.revision ?? '')
  ) {
    fail('candidate ledger is not publication-qualified');
  }
  return ledger.revision;
}

function expectedWorkflowPath(ref) {
  return `.github/workflows/${LATEST_PROOF_WORKFLOW}@refs/heads/${ref}`;
}

export function validateExistingLatestReceipt(receipt, platform, context = null) {
  const [expectedPlatform, expectedArchitecture] = platform.split('-');
  if (
    receipt?.schemaVersion !== 'snapback.package-cold-install.v1'
    || receipt.ok !== true
    || receipt.rootSelector !== 'latest'
    || receipt.installSource !== 'public'
    || receipt.machine?.platform !== expectedPlatform
    || receipt.machine?.architecture !== expectedArchitecture
    || receipt.machine?.runnerEnvironment !== 'github-hosted'
    || receipt.machine?.separatelyProvisionedCleanMachine !== true
  ) {
    fail(`${platform} receipt is not a fresh GitHub-hosted latest-root proof`);
  }
  if (context !== null) {
    validatePublicationReceiptProvenance(receipt, {
      expectedRevision: context.ledgerRevision,
      expectedWorkflow: context.workflow,
      expectedOperationId: context.operationId,
    });
    if (
      receipt.githubProof.runId !== String(context.runId)
      || receipt.githubProof.runAttempt !== String(context.runAttempt)
      || receipt.githubProof.runHeadSha !== context.expectedHeadSha
      || receipt.githubProof.ref !== `refs/heads/${context.ref}`
    ) {
      fail(`${platform} receipt GitHub run correlation drifted`);
    }
  }
  return receipt;
}

function artifactName(platform, runId) {
  return `snapback-${platform}-latest-public-package-receipt-${runId}`;
}

function receiptFilename(platform) {
  return `snapback-${platform}-public-package-receipt.json`;
}

async function wait(delayMs) {
  await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function discoverRun(options, dispatchStartedAt) {
  const deadline = Date.now() + Math.min(options.timeoutMs, 90_000);
  const expectedTitle = `public-package-proof-${options.operationId}`;
  while (Date.now() < deadline) {
    const runs = runGhJson([
      'run',
      'list',
      '--repo', options.repository,
      '--workflow', options.workflow,
      '--branch', options.ref,
      '--event', 'workflow_dispatch',
      '--limit', '50',
      '--json', 'databaseId,displayTitle,createdAt,headSha',
    ]);
    const matches = runs.filter((run) => (
      run.displayTitle === expectedTitle
      && run.headSha === options.expectedHeadSha
      && Date.parse(run.createdAt) >= dispatchStartedAt - 5_000
      && Date.parse(run.createdAt) <= dispatchStartedAt + 90_000
    ));
    if (matches.length === 1) return matches[0].databaseId;
    if (matches.length > 1) fail('workflow dispatch correlation matched multiple runs');
    await wait(2_000);
  }
  fail('dispatched workflow run did not become observable');
}

function readRun(options, runId, dispatchStartedAt) {
  const run = runGhJson([
    'api',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/runs/${runId}`,
  ]);
  const workflow = runGhJson([
    'api',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/workflows/${options.workflow}`,
  ]);
  if (
    run.id !== Number(runId)
    || run.event !== 'workflow_dispatch'
    || run.head_sha !== options.expectedHeadSha
    || run.head_branch !== options.ref
    || run.path !== expectedWorkflowPath(options.ref)
    || run.workflow_id !== workflow.id
    || workflow.path !== `.github/workflows/${options.workflow}`
    || workflow.state !== 'active'
    || run.repository?.full_name !== options.repository
    || run.display_title !== `public-package-proof-${options.operationId}`
    || !Number.isSafeInteger(run.run_attempt)
    || run.run_attempt < 1
    || !Number.isFinite(Date.parse(run.created_at))
    || Date.parse(run.created_at) < dispatchStartedAt - 5_000
    || Date.parse(run.created_at) > dispatchStartedAt + 90_000
  ) {
    fail('GitHub run identity/freshness does not match the closed dispatch');
  }
  return { run, workflow };
}

async function waitForSuccessfulRun(options, runId, dispatchStartedAt) {
  const deadline = dispatchStartedAt + options.timeoutMs;
  while (Date.now() < deadline) {
    const observed = readRun(options, runId, dispatchStartedAt);
    if (observed.run.status === 'completed') {
      if (observed.run.conclusion !== 'success') {
        fail(`GitHub latest-root proof concluded ${observed.run.conclusion}`);
      }
      return observed;
    }
    await wait(4_000);
  }
  fail('GitHub latest-root proof exceeded the publication-lease wait budget');
}

function readArtifacts(options, runId) {
  const response = runGhJson([
    'api',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/runs/${runId}/artifacts?per_page=100`,
  ]);
  if (
    !Number.isSafeInteger(response.total_count)
    || !Array.isArray(response.artifacts)
    || response.total_count !== response.artifacts.length
    || response.total_count > 100
  ) {
    fail('GitHub artifact inventory is incomplete or paginated');
  }
  return response.artifacts;
}

function downloadArtifactReceipt(options, artifact, platform, context) {
  const archiveBytes = runGh([
    'api',
    '--method', 'GET',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/artifacts/${artifact.id}/zip`,
  ], { binary: true, timeout: 60_000 });
  const archiveSha256 = sha256(archiveBytes);
  if (artifact.digest !== `sha256:${archiveSha256}`) {
    fail(`${platform} artifact API digest does not match downloaded bytes`);
  }
  const archivePath = join(
    tmpdir(),
    `snapback-latest-proof-${artifact.id}-${process.pid}-${randomUUID()}.zip`,
  );
  writePrivateAtomic(archivePath, archiveBytes);
  try {
    const extracted = spawnSync('unzip', [
      '-p', archivePath, receiptFilename(platform),
    ], {
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (extracted.status !== 0 || extracted.stdout.byteLength === 0) {
      fail(`could not extract ${platform} receipt from artifact ${artifact.id}`);
    }
    let receipt;
    try {
      receipt = JSON.parse(extracted.stdout.toString('utf8'));
    } catch {
      fail(`${platform} artifact receipt is not JSON`);
    }
    validateExistingLatestReceipt(receipt, platform, context);
    return { bytes: extracted.stdout, archiveSha256 };
  } finally {
    rmSync(archivePath, { force: true });
  }
}

export function validateGithubLatestProofCollection({
  collection,
  options,
  ledgerRevision,
  receiptBytesByPlatform,
  now = Date.now(),
}) {
  exactKeys(collection, COLLECTION_KEYS, 'latest-root proof collection');
  if (
    collection.schemaVersion !== 'snapback.github-latest-root-proof-collection.v2'
    || collection.repository !== options.repository
    || collection.workflow !== options.workflow
    || collection.ref !== options.ref
    || collection.expectedHeadSha !== options.expectedHeadSha
    || collection.runHeadSha !== options.expectedHeadSha
    || collection.operationId !== options.operationId
    || collection.ledgerRevision !== ledgerRevision
    || collection.workflowPath !== expectedWorkflowPath(options.ref)
    || !Number.isSafeInteger(collection.workflowId)
    || collection.workflowId < 1
    || !Number.isSafeInteger(collection.runId)
    || collection.runId < 1
    || !Number.isSafeInteger(collection.runAttempt)
    || collection.runAttempt < 1
  ) {
    fail('latest-root proof collection identity drifted');
  }
  const dispatchStartedAt = Date.parse(collection.dispatchStartedAt);
  const runCreatedAt = Date.parse(collection.runCreatedAt);
  const runStartedAt = Date.parse(collection.runStartedAt);
  const collectedAt = Date.parse(collection.collectedAt);
  if (
    ![dispatchStartedAt, runCreatedAt, runStartedAt, collectedAt].every(Number.isFinite)
    || runCreatedAt < dispatchStartedAt - 5_000
    || runCreatedAt > dispatchStartedAt + 90_000
    || runStartedAt < runCreatedAt - 5_000
    || collectedAt < runStartedAt
    || collectedAt - dispatchStartedAt > 15 * 60_000
    || now < dispatchStartedAt - 5_000
    || now - dispatchStartedAt > 15 * 60_000
  ) {
    fail('latest-root proof collection is stale or temporally inconsistent');
  }
  if (!Array.isArray(collection.artifacts) || collection.artifacts.length !== 2) {
    fail('latest-root proof collection must contain two artifacts');
  }
  if (new Set(collection.artifacts.map((artifact) => artifact?.artifactId)).size !== 2) {
    fail('latest-root proof collection must contain two distinct artifacts');
  }
  for (const [index, platform] of ['darwin-arm64', 'linux-x64'].entries()) {
    const artifact = collection.artifacts[index];
    exactKeys(artifact, ARTIFACT_KEYS, `latest-root ${platform} artifact`);
    const bytes = receiptBytesByPlatform.get(platform);
    if (
      artifact.platform !== platform
      || artifact.artifactName !== artifactName(platform, collection.runId)
      || artifact.receiptFilename !== receiptFilename(platform)
      || !Number.isSafeInteger(artifact.artifactId)
      || artifact.artifactId < 1
      || !/^sha256:[0-9a-f]{64}$/u.test(artifact.apiDigest ?? '')
      || artifact.apiDigest !== `sha256:${artifact.archiveSha256}`
      || !/^[0-9a-f]{64}$/u.test(artifact.receiptSha256 ?? '')
      || !Buffer.isBuffer(bytes)
      || sha256(bytes) !== artifact.receiptSha256
    ) {
      fail(`latest-root ${platform} artifact evidence drifted`);
    }
    const receipt = JSON.parse(bytes.toString('utf8'));
    validateExistingLatestReceipt(receipt, platform, collection);
  }
  return collection;
}

function reopenCollection(options, collection, ledgerRevision) {
  const receiptBytesByPlatform = new Map([
    ['darwin-arm64', readFileSync(options.darwinReceipt)],
    ['linux-x64', readFileSync(options.linuxReceipt)],
  ]);
  validateGithubLatestProofCollection({
    collection,
    options,
    ledgerRevision,
    receiptBytesByPlatform,
  });
  const observed = readRun(
    options,
    collection.runId,
    Date.parse(collection.dispatchStartedAt),
  );
  if (
    observed.run.status !== 'completed'
    || observed.run.conclusion !== 'success'
    || observed.run.run_attempt !== collection.runAttempt
    || observed.run.created_at !== collection.runCreatedAt
    || observed.run.run_started_at !== collection.runStartedAt
    || observed.workflow.id !== collection.workflowId
  ) {
    fail('GitHub run changed or is not successful during collection reopen');
  }
  const currentArtifacts = readArtifacts(options, collection.runId);
  for (const retained of collection.artifacts) {
    const matches = currentArtifacts.filter((artifact) => (
      artifact.id === retained.artifactId
      && artifact.name === retained.artifactName
      && artifact.expired !== true
    ));
    if (
      matches.length !== 1
      || matches[0].digest !== retained.apiDigest
    ) {
      fail(`GitHub artifact ${retained.artifactId} changed during collection reopen`);
    }
    // Re-download on every reopen. API metadata alone cannot prove that a
    // locally retained receipt was actually extracted from the named artifact.
    const downloaded = downloadArtifactReceipt(
      options,
      matches[0],
      retained.platform,
      collection,
    );
    if (
      downloaded.archiveSha256 !== retained.archiveSha256
      || !downloaded.bytes.equals(receiptBytesByPlatform.get(retained.platform))
    ) {
      fail(`GitHub artifact ${retained.artifactId} bytes changed during collection reopen`);
    }
  }
  return validateGithubLatestProofCollection({
    collection,
    options,
    ledgerRevision,
    receiptBytesByPlatform,
  });
}

async function dispatch(options) {
  const ledgerRevision = readLedgerRevision(options);
  const dispatchStartedAt = Date.now();
  runGh([
    'workflow', 'run', options.workflow,
    '--repo', options.repository,
    '--ref', options.ref,
    '-f', `ledger_path=${options.ledgerPath}`,
    '-f', 'root_selector=latest',
    '-f', `operation_id=${options.operationId}`,
  ]);
  const runId = await discoverRun(options, dispatchStartedAt);
  const observed = await waitForSuccessfulRun(options, runId, dispatchStartedAt);
  const artifacts = readArtifacts(options, runId);
  const context = {
    repository: options.repository,
    workflow: options.workflow,
    ref: options.ref,
    expectedHeadSha: options.expectedHeadSha,
    operationId: options.operationId,
    ledgerRevision,
    runId,
    runAttempt: observed.run.run_attempt,
  };
  const retainedArtifacts = [];
  for (const [platform, outputPath] of [
    ['darwin-arm64', options.darwinReceipt],
    ['linux-x64', options.linuxReceipt],
  ]) {
    const name = artifactName(platform, runId);
    const matches = artifacts.filter((artifact) => (
      artifact.name === name && artifact.expired !== true
    ));
    if (matches.length !== 1) fail(`GitHub run has ${matches.length} current ${name} artifacts`);
    const artifact = matches[0];
    const downloaded = downloadArtifactReceipt(options, artifact, platform, context);
    writePrivateAtomic(outputPath, downloaded.bytes);
    retainedArtifacts.push({
      platform,
      artifactId: artifact.id,
      artifactName: artifact.name,
      apiDigest: artifact.digest,
      archiveSha256: downloaded.archiveSha256,
      receiptFilename: receiptFilename(platform),
      receiptSha256: sha256(downloaded.bytes),
    });
  }
  const collection = {
    schemaVersion: 'snapback.github-latest-root-proof-collection.v2',
    repository: options.repository,
    workflow: options.workflow,
    workflowId: observed.workflow.id,
    workflowPath: observed.run.path,
    ref: options.ref,
    expectedHeadSha: options.expectedHeadSha,
    runHeadSha: observed.run.head_sha,
    operationId: options.operationId,
    ledgerRevision,
    runId,
    runAttempt: observed.run.run_attempt,
    dispatchStartedAt: new Date(dispatchStartedAt).toISOString(),
    runCreatedAt: observed.run.created_at,
    runStartedAt: observed.run.run_started_at,
    collectedAt: new Date().toISOString(),
    artifacts: retainedArtifacts,
  };
  writePrivateAtomic(
    options.collection,
    Buffer.from(`${JSON.stringify(collection, null, 2)}\n`),
  );
  reopenCollection(options, collection, ledgerRevision);
  process.stdout.write(`${JSON.stringify(collection)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (options.mode === 'verify-collection') {
    const ledgerRevision = readLedgerRevision(options);
    const collection = JSON.parse(readFileSync(options.collection, 'utf8'));
    reopenCollection(options, collection, ledgerRevision);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'snapback.github-latest-root-proof-verification.v2',
      runId: collection.runId,
      runAttempt: collection.runAttempt,
      operationId: collection.operationId,
      collection: options.collection,
    })}\n`);
    return;
  }
  await dispatch(options);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
