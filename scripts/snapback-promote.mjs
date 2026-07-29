#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPostPromotionLedger,
  canonicalJcs,
  publicationAuthorityTransition,
  promoteDefaultVector,
  sha256Hex,
  validatePublicationAuthorityHead,
  validatePublicationLease,
  validatePublicationAuthorityReceipt,
  validateClosedLatestProofPlan,
  validatePreClosePublicationState,
  validatePriorDependencyAlias,
  waitForPromotedInstallability,
} from './snapback-promotion-core.mjs';
import {
  parseBoundedJsonBytes,
  readBoundedFileBytes,
  readBoundedJsonFile,
  sha256File,
  validateCandidateLedger,
} from './snapback-publish-core.mjs';
import {
  validateFinalLatestReceipts,
  validateLatestRootResolution,
} from './snapback-package-cold-install-lib.mjs';
import {
  fetchPublicationAuthorityJson,
} from '../packages/snapback-publication-authority/request.mjs';

const registry = 'https://registry.npmjs.org';
const LATEST_ROOT_PROBE_ATTEMPTS = 6;
const LATEST_ROOT_PROBE_DELAY_MS = 10_000;
const LATEST_ROOT_PROBE_TIMEOUT_MS = 45_000;
const PROMOTION_ROLLBACK_RESERVE_MS = 120_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const latestProofHelper = join(
  repositoryRoot,
  'scripts',
  'snapback-github-latest-proof.mjs',
);
const usage = `usage: node scripts/snapback-promote.mjs
  --ledger <candidate-ledger.json> --lease <authorized-lease.json>
  --public-key <ed25519-public-key.pem>
  --authority-url <https-origin> --publisher-instance <id>
  --latest-proof-plan <plan.json> --post-ledger <ledger.json>
  --out <promotion-receipt.json> [--otp <code>]

Default-tag promotion is always a real registry operation. It requires
SNAPBACK_PUBLISH_CONFIRM=yes-really and an externally authorized, current
publication lease. SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE names the mounted
Bearer-token file for the lease-bound authority origin. The proof plan is
closed data for the package-owned GitHub helper; it cannot name commands or
arbitrary argv. The helper dispatches and reopens one fresh macOS/arm64 +
Linux/x64 matrix after the tag vector moves. Any proof or authority-close
failure enters the same strict reverse-order rollback path.`;

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
    else if (arg === '--authority-url') options.authorityUrl = value;
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
    'authorityUrl',
    'publisherInstanceId',
    'latestProofPlan',
    'postLedger',
    'out',
  ]) {
    if (!options[field]) fail(`--${field.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is required\n${usage}`, 2);
  }
  let authority;
  try {
    authority = new URL(options.authorityUrl);
  } catch {
    fail('--authority-url must be an absolute HTTPS origin', 2);
  }
  if (
    authority.protocol !== 'https:'
    || authority.username
    || authority.password
    || authority.search
    || authority.hash
    || (authority.pathname !== '' && authority.pathname !== '/')
  ) {
    fail('--authority-url must be one HTTPS origin without path or credentials', 2);
  }
  options.authorityUrl = authority.origin;
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

const ledger = readBoundedJsonFile(options.ledger, 'candidate publication ledger');
try {
  validateCandidateLedger(ledger);
} catch (error) {
  fail(`candidate ledger refused: ${error.message}`);
}
const candidateLedgerSha256 = ledger.candidateLedgerSha256;
const authorityPublicKey = readFileSync(options.publicKey);
const authorityTokenPath = process.env.SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE;
if (!authorityTokenPath) {
  fail('SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE must name a Bearer-token file');
}
const authorityToken = readFileSync(authorityTokenPath, 'utf8').trim();
if (authorityToken.length < 16) {
  fail('SNAPBACK_PUBLICATION_LEASE_TOKEN_FILE must contain at least 16 bytes');
}

const lease = readBoundedJsonFile(options.lease, 'authorized publication lease');
validatePublicationLease({
  lease,
  publicKey: authorityPublicKey,
  authorityOrigin: options.authorityUrl,
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

async function observePublicLatestRootInstallability({ expectedVector }) {
  const cliLeaseRow = lease.packages.find(
    (row) => row.name === '@ccheever/snapback-cli',
  );
  if (!cliLeaseRow) {
    throw new Error('public latest-root probe has no CLI lease row');
  }
  const runtimePackages = new Map([
    ['darwin-arm64', '@snapback/runtime-darwin-arm64'],
    ['linux-x64', '@snapback/runtime-linux-x64'],
  ]);
  const hostRuntime = runtimePackages.get(`${process.platform}-${process.arch}`);
  if (!hostRuntime) {
    throw new Error('public latest-root probe has no supported host runtime');
  }
  const temporaryRoot = mkdtempSync(join(dirname(options.out), '.snapback-latest-root-'));
  const appRoot = join(temporaryRoot, 'app');
  const cacheRoot = join(temporaryRoot, 'npm-cache');
  mkdirSync(appRoot, { recursive: true });
  writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-latest-root-propagation-probe',
    version: '1.0.0',
    private: true,
    dependencies: {
      '@snapback/cli': 'npm:@ccheever/snapback-cli@latest',
    },
  }, null, 2)}\n`);
  let rootVersion = null;
  const probeDeadline = Date.now() + LATEST_ROOT_PROBE_TIMEOUT_MS;
  try {
    const install = spawnSync('npm', [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--prefer-online',
      '--cache', cacheRoot,
      '--registry', registry,
    ], {
      cwd: appRoot,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: Math.max(
        1,
        Math.min(35_000, probeDeadline - Date.now()),
      ),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const rootManifestPath = join(
      appRoot,
      'node_modules',
      '@snapback',
      'cli',
      'package.json',
    );
    if (existsSync(rootManifestPath)) {
      rootVersion = readBoundedJsonFile(
        rootManifestPath,
        'public latest-root manifest',
      ).version ?? null;
    }
    if (install.status !== 0) {
      return {
        ok: false,
        rootVersion: null,
        closure: null,
        error: `fresh-cache npm install failed with ${
          install.status ?? install.signal ?? 'unknown'
        }`,
        retryablePriorRoot: false,
      };
    }
    const treeTimeoutMs = probeDeadline - Date.now();
    if (treeTimeoutMs < 1) {
      return {
        ok: false,
        rootVersion,
        closure: null,
        error: 'fresh-cache npm install exhausted the probe deadline',
        retryablePriorRoot: false,
      };
    }
    const listed = spawnSync('npm', ['ls', '--all', '--json'], {
      cwd: appRoot,
      encoding: null,
      maxBuffer: 8 * 1024 * 1024,
      timeout: treeTimeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (listed.status !== 0 || !Buffer.isBuffer(listed.stdout)) {
      return {
        ok: false,
        rootVersion: null,
        closure: null,
        error: `fresh-cache npm tree failed with ${
          listed.status ?? listed.signal ?? 'unknown'
        }`,
        retryablePriorRoot: false,
      };
    }
    const tree = parseBoundedJsonBytes(
      listed.stdout,
      'public latest-root npm tree',
      { maxBytes: 8 * 1024 * 1024 },
    );
    try {
      const closure = validateLatestRootResolution({
        tree,
        ledger,
        hostRuntime,
        tagVector: expectedVector,
      });
      return {
        ok: true,
        rootVersion,
        closure,
        error: null,
        retryablePriorRoot: false,
      };
    } catch (error) {
      return {
        ok: false,
        rootVersion,
        closure: null,
        error: error.message.slice(0, 1_000),
        retryablePriorRoot:
          cliLeaseRow.expectedPriorVersion !== cliLeaseRow.newVersion
          && rootVersion === cliLeaseRow.expectedPriorVersion,
      };
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
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

  const selected = new Set(lease.packages.map((row) => row.name));
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
      for (const section of [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'devDependencies',
      ]) {
        for (const [dependency, value] of Object.entries(manifest[section] ?? {})) {
          if (/^(?:workspace:|file:|link:)/.test(String(value))) {
            throw new Error(`prior ${row.name} contains non-registry ${section}.${dependency}`);
          }
          if (
            selected.has(dependency)
            || dependency.startsWith('@ccheever/snapback-')
          ) {
            throw new Error(
              `prior ${row.name} contains direct public internal key ${section}.${dependency}`,
            );
          }
          const match = String(value).match(
            /^npm:(@ccheever\/snapback-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/,
          );
          if (String(value).includes('@ccheever/snapback-') && !match) {
            throw new Error(`prior ${row.name} contains non-exact Snapback alias ${section}.${dependency}`);
          }
          if (dependency.startsWith('@snapback/') && !match) {
            throw new Error(
              `prior ${row.name} contains non-exact Snapback alias ${section}.${dependency}`,
            );
          }
          if (!match) continue;
          const [, target, version] = match;
          const binding = validatePriorDependencyAlias({
            lease,
            ownerName: row.name,
            dependency,
            target,
            version,
          });
          dependencyAliases.push({
            section,
            dependency,
            target,
            version,
            sectionVector: binding.sectionVector,
          });
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
  const challenge = randomBytes(32).toString('hex');
  const response = await fetchPublicationAuthorityJson(`${options.authorityUrl}/v1/head`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${authorityToken}`,
      'x-snapback-publication-challenge': challenge,
    },
  });
  if (!response.ok) throw new Error(`external lease head returned HTTP ${response.status}`);
  return validatePublicationAuthorityHead({
    head: response.value,
    publicKey: authorityPublicKey,
    authorityInstallationId: lease.authorityInstallationId,
    authorityOrigin: options.authorityUrl,
    expectedChallenge: challenge,
  });
}

function authorityHeaders() {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  headers.authorization = `Bearer ${authorityToken}`;
  return headers;
}

async function transitionAuthority(path, transition) {
  const response = await fetchPublicationAuthorityJson(`${options.authorityUrl}${path}`, {
    method: 'POST',
    headers: authorityHeaders(),
    body: canonicalJcs(transition),
  });
  if (!response.ok) {
    throw new Error(`external publication authority returned HTTP ${response.status}`);
  }
  return validatePublicationAuthorityReceipt({
    receipt: response.value,
    transition,
    publicKey: authorityPublicKey,
    authorityInstallationId: lease.authorityInstallationId,
    authorityOrigin: options.authorityUrl,
  });
}

function loadLatestProofPlan() {
  const plan = readBoundedJsonFile(options.latestProofPlan, 'latest-root proof plan');
  const ledgerRelative = relative(repositoryRoot, options.ledger).replaceAll('\\', '/');
  if (
    plan.ledgerPath !== ledgerRelative
    || ledgerRelative.startsWith('../')
    || ledgerRelative === ''
  ) {
    throw new Error('latest-root proof plan ledger path drifted');
  }
  for (const field of ['darwinReceipt', 'linuxReceipt', 'collection']) {
    const value = plan[field];
    if (
      typeof value !== 'string'
      || value.startsWith('/')
      || value.split('/').some((part) => part === '' || part === '..')
    ) {
      throw new Error(`latest-root proof plan ${field} must be normalized and relative`);
    }
  }
  const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  const checkoutDirty = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=no'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).length > 0;
  if (checkoutHead !== plan.expectedHeadSha || checkoutDirty) {
    throw new Error('latest-root proof helper checkout provenance drifted');
  }
  return validateClosedLatestProofPlan({
    plan,
    expectedOperationId: lease.operationId,
    expectedHelperSha256: sha256File(latestProofHelper),
    expectedLedgerPath: ledgerRelative,
    expectedHeadSha: checkoutHead,
  });
}

function executeLatestProofPlan(plan) {
  const reopenedPlan = loadLatestProofPlan();
  if (canonicalJcs(reopenedPlan) !== canonicalJcs(plan)) {
    throw new Error('latest-root proof plan changed after preflight');
  }
  const planRoot = dirname(options.latestProofPlan);
  const darwinReceipt = resolve(planRoot, plan.darwinReceipt);
  const linuxReceipt = resolve(planRoot, plan.linuxReceipt);
  const collectionPath = resolve(planRoot, plan.collection);
  const commonArgs = [
    '--repository', plan.repository,
    '--workflow', plan.workflow,
    '--ref', plan.ref,
    '--expected-head-sha', plan.expectedHeadSha,
    '--ledger-path', plan.ledgerPath,
    '--operation-id', plan.operationId,
    '--darwin-receipt', darwinReceipt,
    '--linux-receipt', linuxReceipt,
    '--collection', collectionPath,
  ];
  for (const [mode, timeoutMs] of [
    ['dispatch', plan.dispatchTimeoutMs],
    ['verify-collection', plan.verifyTimeoutMs],
  ]) {
    const result = spawnSync(process.execPath, [
      latestProofHelper,
      mode,
      ...commonArgs,
      '--timeout-ms', String(timeoutMs),
    ], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
      throw new Error(
        `latest-root package-owned ${mode} failed with ${result.status ?? result.signal ?? 'unknown'}`,
      );
    }
  }
  const collection = readBoundedJsonFile(
    collectionPath,
    'latest-root proof collection',
  );
  const records = [];
  for (const [platform, path] of [
    ['darwin-arm64', darwinReceipt],
    ['linux-x64', linuxReceipt],
  ]) {
    if (!existsSync(path)) {
      throw new Error(`latest-root ${platform} proof omitted its receipt`);
    }
    const bytes = readBoundedFileBytes(path, `latest-root ${platform} receipt`);
    records.push({
      path,
      sha256: sha256Hex(bytes),
      receipt: parseBoundedJsonBytes(bytes, `latest-root ${platform} receipt`),
      githubArtifact: collection.artifacts?.find((row) => row.platform === platform),
    });
  }
  return validateFinalLatestReceipts({
    ledger,
    records,
    githubCollection: collection,
  });
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

let latestProofPlan;
try {
  // Refuse a dirty/wrong checkout or substituted helper before acquiring the
  // authority lease. executeLatestProofPlan reopens this frozen plan directly
  // before dispatch to close the local TOCTOU window.
  latestProofPlan = loadLatestProofPlan();
} catch (error) {
  fail(`latest-root proof preflight refused: ${error.message}`);
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
    '/v1/leases/acquire',
    acquisition,
  );
  authorityAcquired = true;
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  receipt.priorDefaultClosurePreflight = await preflightPriorDefaultClosure();
  writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  const result = await promoteDefaultVector({
    lease,
    authorityPublicKey,
    readVector,
    readLeaseHead,
    setTag,
    removeTag,
    record(event) {
      receipt.events.push(event);
      writeFileSync(options.out, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    },
    async afterPromotion({ vector, events }) {
      const publicLatestRootBarrier = await waitForPromotedInstallability({
        lease,
        authorityPublicKey,
        expectedVector: vector,
        readVector,
        readLeaseHead,
        observeInstallability: observePublicLatestRootInstallability,
        attempts: LATEST_ROOT_PROBE_ATTEMPTS,
        delayMs: LATEST_ROOT_PROBE_DELAY_MS,
        probeBoundMs: LATEST_ROOT_PROBE_TIMEOUT_MS,
        requiredRemainingMs:
          latestProofPlan.dispatchTimeoutMs
          + latestProofPlan.verifyTimeoutMs
          + PROMOTION_ROLLBACK_RESERVE_MS,
        record(evidence) {
          receipt.publicLatestRootBarrier = evidence;
          writeFileSync(
            options.out,
            `${JSON.stringify(receipt, null, 2)}\n`,
            { mode: 0o600 },
          );
        },
      });
      const latestRootReceipts = executeLatestProofPlan(latestProofPlan);
      // @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
      // — reopen registry truth and a nonce-bound acquired head after proof,
      // immediately before constructing the terminal ledger and close.
      const preCloseVector = await readVector(
        lease.packages.map((row) => row.name),
      );
      const preCloseAuthorityHead = await readLeaseHead();
      validatePreClosePublicationState({
        lease,
        authorityPublicKey,
        expectedVector: vector,
        observedVector: preCloseVector,
        head: preCloseAuthorityHead,
      });
      validatePublicationLease({
        lease,
        publicKey: authorityPublicKey,
        authorityOrigin: options.authorityUrl,
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
        preCloseAuthorityHead,
        preCloseRegistryObservation: {
          observedAt: new Date().toISOString(),
          vector: preCloseVector,
        },
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
      const authorityClosure = await transitionAuthority('/v1/leases/close', closure);
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
    if (receipt.finalVector === null) {
      try {
        receipt.finalVector = await readVector(
          lease.packages.map((row) => row.name),
        );
      } catch (observationError) {
        receipt.finalVectorObservationError = observationError.message;
      }
    }
    if (canonicalJcs(receipt.finalVector) === canonicalJcs(priorVector)) {
      try {
        const rollbackClosure = publicationAuthorityTransition({
          lease,
          outcome: 'rolled-back',
          vector: priorVector,
        });
        receipt.authorityRollbackClosure = await transitionAuthority(
          '/v1/leases/close',
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
