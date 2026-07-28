#!/usr/bin/env node

// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — the final
// latest-root proof must come from fresh GitHub-hosted macOS and Linux
// machines after the root tag moves, within the bounded publication lease.

import { createHash, randomUUID } from 'node:crypto';
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
import { spawnSync } from 'node:child_process';

const usage = `usage:
  node scripts/snapback-github-latest-proof.mjs dispatch
    --repository <owner/repo> --workflow <workflow.yml> --ref <branch>
    --ledger-path <repo-relative-ledger.json> --operation-id <id>
    --darwin-receipt <path> --linux-receipt <path> --run-id-file <path>
    [--timeout-ms <1000..450000>]

  node scripts/snapback-github-latest-proof.mjs verify-existing
    --platform <darwin-arm64|linux-x64> --receipt <path>`;

function fail(message) {
  throw new Error(`snapback-github-latest-proof: ${message}`);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (mode === '--help' || mode === '-h') return { help: true };
  if (!['dispatch', 'verify-existing'].includes(mode)) fail(`unknown mode\n${usage}`);
  const options = { mode, timeoutMs: 440_000 };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`${argument} requires a value`);
    const key = {
      '--repository': 'repository',
      '--workflow': 'workflow',
      '--ref': 'ref',
      '--ledger-path': 'ledgerPath',
      '--operation-id': 'operationId',
      '--darwin-receipt': 'darwinReceipt',
      '--linux-receipt': 'linuxReceipt',
      '--run-id-file': 'runIdFile',
      '--timeout-ms': 'timeoutMs',
      '--platform': 'platform',
      '--receipt': 'receipt',
    }[argument];
    if (!key) fail(`unknown argument ${argument}`);
    if (Object.hasOwn(options, key) && key !== 'timeoutMs') fail(`duplicate argument ${argument}`);
    options[key] = key === 'timeoutMs' ? Number(value) : value;
  }
  if (mode === 'verify-existing') {
    if (!['darwin-arm64', 'linux-x64'].includes(options.platform) || !options.receipt) {
      fail(`verify-existing requires --platform and --receipt\n${usage}`);
    }
    options.receipt = resolve(options.receipt);
    return options;
  }
  for (const key of [
    'repository',
    'workflow',
    'ref',
    'ledgerPath',
    'operationId',
    'darwinReceipt',
    'linuxReceipt',
    'runIdFile',
  ]) {
    if (!options[key]) fail(`dispatch requires ${key}\n${usage}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(options.repository)) {
    fail('--repository must be one owner/repository identity');
  }
  if (!/^[A-Za-z0-9_.-]+\.ya?ml$/u.test(options.workflow)) {
    fail('--workflow must be one workflow filename');
  }
  if (!/^[A-Za-z0-9._/-]{1,200}$/u.test(options.ref) || options.ref.includes('..')) {
    fail('--ref is invalid');
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
  if (
    !Number.isSafeInteger(options.timeoutMs)
    || options.timeoutMs < 1_000
    || options.timeoutMs > 450_000
  ) {
    fail('--timeout-ms must be an integer in [1000, 450000]');
  }
  for (const key of ['darwinReceipt', 'linuxReceipt', 'runIdFile']) {
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
  const output = runGh(args);
  try {
    return JSON.parse(output);
  } catch {
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

export function validateExistingLatestReceipt(receipt, platform) {
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
    || !/^[0-9]+$/u.test(receipt.machine?.githubRunId ?? '')
  ) {
    fail(`${platform} receipt is not a fresh GitHub-hosted latest-root proof`);
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

async function discoverRun(options, startedAtMs) {
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
      '--json', 'databaseId,displayTitle,createdAt,status,conclusion,headSha,url',
    ]);
    const matches = runs
      .filter((run) => (
        run.displayTitle === expectedTitle
        && Date.parse(run.createdAt) >= startedAtMs - 30_000
      ))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    if (matches.length > 0) return matches[0];
    await wait(2_000);
  }
  fail('dispatched workflow run did not become observable');
}

async function waitForSuccessfulRun(options, runId, deadline) {
  while (Date.now() < deadline) {
    const run = runGhJson([
      'run', 'view', String(runId),
      '--repo', options.repository,
      '--json', 'status,conclusion,url,headSha',
    ]);
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') {
        fail(`GitHub latest-root proof concluded ${run.conclusion}: ${run.url}`);
      }
      return run;
    }
    await wait(4_000);
  }
  fail('GitHub latest-root proof exceeded the publication-lease wait budget');
}

function downloadArtifactReceipt(options, artifact, platform) {
  const archiveBytes = runGh([
    'api',
    '--method', 'GET',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/artifacts/${artifact.id}/zip`,
  ], { binary: true, timeout: 60_000 });
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
    validateExistingLatestReceipt(receipt, platform);
    return { bytes: extracted.stdout, receipt };
  } finally {
    rmSync(archivePath, { force: true });
  }
}

async function dispatch(options) {
  const startedAtMs = Date.now();
  runGh([
    'workflow', 'run', options.workflow,
    '--repo', options.repository,
    '--ref', options.ref,
    '-f', `ledger_path=${options.ledgerPath}`,
    '-f', 'root_selector=latest',
    '-f', `operation_id=${options.operationId}`,
  ]);
  const run = await discoverRun(options, startedAtMs);
  const runIdentity = {
    schemaVersion: 'snapback.github-latest-root-run.v1',
    repository: options.repository,
    workflow: options.workflow,
    ref: options.ref,
    operationId: options.operationId,
    runId: run.databaseId,
    url: run.url,
    observedAt: new Date().toISOString(),
  };
  writePrivateAtomic(options.runIdFile, Buffer.from(`${JSON.stringify(runIdentity, null, 2)}\n`));
  await waitForSuccessfulRun(options, run.databaseId, startedAtMs + options.timeoutMs);
  const artifacts = runGhJson([
    'api',
    '-H', 'Accept: application/vnd.github+json',
    `repos/${options.repository}/actions/runs/${run.databaseId}/artifacts?per_page=100`,
  ]).artifacts ?? [];
  const outputs = [];
  for (const [platform, outputPath] of [
    ['darwin-arm64', options.darwinReceipt],
    ['linux-x64', options.linuxReceipt],
  ]) {
    const name = artifactName(platform, run.databaseId);
    const matches = artifacts.filter((artifact) => artifact.name === name && artifact.expired !== true);
    if (matches.length !== 1) fail(`GitHub run has ${matches.length} current ${name} artifacts`);
    const downloaded = downloadArtifactReceipt(options, matches[0], platform);
    if (String(downloaded.receipt.machine.githubRunId) !== String(run.databaseId)) {
      fail(`${platform} receipt run identity does not match the dispatched run`);
    }
    writePrivateAtomic(outputPath, downloaded.bytes);
    outputs.push({
      platform,
      path: outputPath,
      sha256: sha256(downloaded.bytes),
    });
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.github-latest-root-proof-collection.v1',
    runId: run.databaseId,
    operationId: options.operationId,
    receipts: outputs,
  })}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  if (options.mode === 'verify-existing') {
    const bytes = readFileSync(options.receipt);
    const receipt = JSON.parse(bytes.toString('utf8'));
    validateExistingLatestReceipt(receipt, options.platform);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'snapback.github-latest-root-existing-verification.v1',
      platform: options.platform,
      receipt: options.receipt,
      sha256: sha256(bytes),
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

