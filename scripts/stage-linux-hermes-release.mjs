#!/usr/bin/env node

// Resolve, verify, and stage the Linux Hermes release carrier for the exact
// committed vendor/ibex gitlink.
//
// Stable refusal codes:
// SNAPBACK_HERMES_CARRIER_GITLINK_UNAVAILABLE
// SNAPBACK_HERMES_CARRIER_IDENTITY_SOURCE_UNAVAILABLE
// SNAPBACK_HERMES_CARRIER_IDENTITY_DERIVATION_FAILED
// SNAPBACK_HERMES_CARRIER_RELEASE_ASSET_MISSING
// SNAPBACK_HERMES_CARRIER_CHECKSUM_MISMATCH
// SNAPBACK_HERMES_CARRIER_ATTESTATION_FAILED
// SNAPBACK_HERMES_CARRIER_ATTESTATION_TOOL_UNAVAILABLE
// SNAPBACK_HERMES_CARRIER_BUNDLE_STRUCTURE_INVALID
// SNAPBACK_HERMES_CARRIER_RECEIPT_MISMATCH
// SNAPBACK_HERMES_CARRIER_STALE_ASSET_PRESENT
// SNAPBACK_HERMES_CARRIER_SYMBOL_MISSING
// SNAPBACK_HERMES_CARRIER_ARGUMENT_INVALID

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CODES = Object.freeze({
  GITLINK_UNAVAILABLE: 'SNAPBACK_HERMES_CARRIER_GITLINK_UNAVAILABLE',
  IDENTITY_SOURCE_UNAVAILABLE: 'SNAPBACK_HERMES_CARRIER_IDENTITY_SOURCE_UNAVAILABLE',
  IDENTITY_DERIVATION_FAILED: 'SNAPBACK_HERMES_CARRIER_IDENTITY_DERIVATION_FAILED',
  RELEASE_ASSET_MISSING: 'SNAPBACK_HERMES_CARRIER_RELEASE_ASSET_MISSING',
  CHECKSUM_MISMATCH: 'SNAPBACK_HERMES_CARRIER_CHECKSUM_MISMATCH',
  ATTESTATION_FAILED: 'SNAPBACK_HERMES_CARRIER_ATTESTATION_FAILED',
  ATTESTATION_TOOL_UNAVAILABLE: 'SNAPBACK_HERMES_CARRIER_ATTESTATION_TOOL_UNAVAILABLE',
  BUNDLE_STRUCTURE_INVALID: 'SNAPBACK_HERMES_CARRIER_BUNDLE_STRUCTURE_INVALID',
  RECEIPT_MISMATCH: 'SNAPBACK_HERMES_CARRIER_RECEIPT_MISMATCH',
  STALE_ASSET_PRESENT: 'SNAPBACK_HERMES_CARRIER_STALE_ASSET_PRESENT',
  SYMBOL_MISSING: 'SNAPBACK_HERMES_CARRIER_SYMBOL_MISSING',
  ARGUMENT_INVALID: 'SNAPBACK_HERMES_CARRIER_ARGUMENT_INVALID',
});

export const ATTESTATION = Object.freeze({
  repo: 'expo/ibex',
  signerWorkflow: 'expo/ibex/.github/workflows/hermes-artifacts.yml',
  sourceRef: 'refs/heads/main',
});

const REQUIRED_ARCHIVE_PATHS = [
  'scripts/hermes-version.sh',
  'scripts/apply-hermes-patches.sh',
  'scripts/build-hermes.sh',
  'scripts/build-hermes-linux.sh',
  ':(glob)patches/hermes/*.patch',
];
const REQUIRED_BUNDLE_PATHS = [
  'include/jsi/jsi.h',
  'bin/hermesc',
  'bin/hermes',
  'lib/libhermesvm.so',
  'lib/libhermesvm_a.a',
  'lib/libjsi.a',
  'lib/libboost_context.a',
  'lib/hermes-profile-provenance.json',
];
const RELEASE_ASSET = /^hermes-linux-x64-.*\.tar\.gz(?:\.sha256|\.sigstore\.json)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function defaultRunCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: Object.hasOwn(options, 'encoding') ? options.encoding : 'utf8',
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function output(result) {
  const stdout = Buffer.isBuffer(result?.stdout)
    ? result.stdout.toString('utf8')
    : (result?.stdout ?? '');
  const stderr = Buffer.isBuffer(result?.stderr)
    ? result.stderr.toString('utf8')
    : (result?.stderr ?? '');
  return `${stdout}${stderr}`.trim();
}

function succeeded(result) {
  return !result?.error && result?.status === 0;
}

function checked(runCommand, command, args, options, code, message) {
  const result = runCommand(command, args, options);
  if (!succeeded(result)) {
    const detail = output(result);
    fail(code, `${message}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = openSync(path, 'r');
  try {
    for (let bytesRead = readSync(descriptor, buffer); bytesRead > 0;) {
      hash.update(buffer.subarray(0, bytesRead));
      bytesRead = readSync(descriptor, buffer);
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function cleanDerivationEnvironment(env) {
  const clean = { ...env };
  for (const name of [
    'IBEX_HERMES_VERSION',
    'IBEX_HERMES_SOURCE_REF',
    'IBEX_HERMES_SOURCE_COMMIT',
    'IBEX_HERMES_BUILD_REF',
  ]) delete clean[name];
  return clean;
}

export function resolveIbexGitlink({ root, runCommand = defaultRunCommand, env = process.env }) {
  const result = runCommand('git', ['-C', root, 'ls-tree', 'HEAD', '--', 'vendor/ibex'], {
    encoding: 'utf8',
    env,
  });
  if (!succeeded(result)) {
    fail(CODES.GITLINK_UNAVAILABLE, `could not read the committed vendor/ibex gitlink: ${output(result)}`);
  }
  const match = /^160000 commit ([0-9a-f]{40})\s+vendor\/ibex\s*$/u.exec(String(result.stdout).trim());
  if (!match) {
    fail(CODES.GITLINK_UNAVAILABLE, 'HEAD does not contain one committed vendor/ibex gitlink');
  }
  return match[1];
}

export function findIbexIdentitySource({
  root,
  gitlink,
  runCommand = defaultRunCommand,
  env = process.env,
  ibexPath = join(root, 'vendor', 'ibex'),
}) {
  const candidates = [ibexPath];
  if (env.SNAPBACK_IBEX_CHECKOUT) candidates.push(resolve(env.SNAPBACK_IBEX_CHECKOUT));
  for (const candidate of [...new Set(candidates)]) {
    const gitDir = runCommand('git', ['-C', candidate, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      env,
    });
    if (!succeeded(gitDir)) continue;
    const commit = runCommand('git', ['-C', candidate, 'cat-file', '-e', `${gitlink}^{commit}`], {
      encoding: 'utf8',
      env,
    });
    if (succeeded(commit)) return candidate;
  }
  fail(
    CODES.IDENTITY_SOURCE_UNAVAILABLE,
    `no approved Ibex object database contains committed gitlink ${gitlink}`,
  );
}

export function deriveHermesIdentity({
  root,
  runCommand = defaultRunCommand,
  env = process.env,
  ibexPath = join(root, 'vendor', 'ibex'),
  temporaryRoot = tmpdir(),
} = {}) {
  const gitlink = resolveIbexGitlink({ root, runCommand, env });
  const source = findIbexIdentitySource({ root, gitlink, runCommand, env, ibexPath });
  const scratch = mkdtempSync(join(temporaryRoot, 'snapback-hermes-identity-'));
  try {
    const archive = checked(
      runCommand,
      'git',
      ['-C', source, 'archive', gitlink, '--', ...REQUIRED_ARCHIVE_PATHS],
      { encoding: null, env },
      CODES.IDENTITY_DERIVATION_FAILED,
      `could not materialize the reviewed Hermes identity inputs at ${gitlink}`,
    );
    checked(
      runCommand,
      'tar',
      ['-x', '-C', scratch],
      { encoding: 'utf8', env, input: archive.stdout },
      CODES.IDENTITY_DERIVATION_FAILED,
      'could not unpack the reviewed Hermes identity inputs',
    );

    // @ref LLP 0010#native-runtime-bootstrap — Ibex owns this identity. Source
    // its committed helper closure instead of cloning its derivation in Snapback.
    const script = [
      'set -euo pipefail',
      'source scripts/hermes-version.sh',
      'version_key="${IBEX_HERMES_SOURCE_COMMIT:0:12}"',
      'printf "%s\\n" "$IBEX_HERMES_SOURCE_COMMIT"',
      'printf "%s-%s\\n" "$version_key" "$(ibex_hermes_patch_digest)"',
      'ibex_hermes_linux_source_cache_key "$version_key"',
      'ibex_hermes_patch_stack_digest_hex',
    ].join('\n');
    const derived = checked(
      runCommand,
      'bash',
      ['-c', script],
      { cwd: scratch, encoding: 'utf8', env: cleanDerivationEnvironment(env) },
      CODES.IDENTITY_DERIVATION_FAILED,
      'Ibex Hermes identity derivation failed',
    );
    const lines = String(derived.stdout).trim().split(/\r?\n/u);
    if (
      lines.length !== 4
      || !/^[0-9a-f]{40}$/u.test(lines[0])
      || !/^[0-9a-f]{12}-[0-9a-f]{12}$/u.test(lines[1])
      || !lines[2]
      || !SHA256.test(lines[3])
    ) {
      fail(CODES.IDENTITY_DERIVATION_FAILED, 'Ibex Hermes identity helper returned an invalid result');
    }
    return {
      gitlink,
      hermesSourceCommit: lines[0],
      identity: lines[1],
      cacheKey: lines[2],
      patchStackDigestHex: lines[3],
      patchStackDigest: `sha256-${lines[3]}`,
      identitySource: source,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function ensureReleaseFiles(directory, assetName) {
  const paths = {
    tarball: join(directory, assetName),
    checksum: join(directory, `${assetName}.sha256`),
    sigstore: join(directory, `${assetName}.sigstore.json`),
  };
  for (const [kind, path] of Object.entries(paths)) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      fail(CODES.RELEASE_ASSET_MISSING, `release ${kind} is missing: ${path}`);
    }
  }
  return paths;
}

function verifyChecksum(paths) {
  const firstLine = readFileSync(paths.checksum, 'utf8').split(/\r?\n/u, 1)[0];
  const expected = firstLine.trim().split(/\s+/u)[0];
  const actual = sha256File(paths.tarball);
  if (!SHA256.test(expected) || expected !== actual) {
    fail(CODES.CHECKSUM_MISMATCH, `Hermes tarball checksum mismatch: expected ${expected || '<missing>'}, got ${actual}`);
  }
  return actual;
}

function ghUnavailable(result) {
  return result?.error?.code === 'ENOENT'
    || /not authenticated|authentication required|not logged|gh auth login|http 401|http 403/iu.test(output(result));
}

function verifyAttestation(paths, { runCommand, env, offline }) {
  const args = [
    'attestation', 'verify', paths.tarball,
    '--repo', ATTESTATION.repo,
    '--signer-workflow', ATTESTATION.signerWorkflow,
    '--source-ref', ATTESTATION.sourceRef,
    '--deny-self-hosted-runners',
  ];
  if (offline) args.push('--bundle', paths.sigstore);
  const result = runCommand('gh', args, { encoding: 'utf8', env });
  if (!succeeded(result)) {
    if (ghUnavailable(result)) {
      fail(CODES.ATTESTATION_TOOL_UNAVAILABLE, `GitHub attestation verification is unavailable: ${output(result)}`);
    }
    fail(CODES.ATTESTATION_FAILED, `GitHub build-provenance attestation verification failed: ${output(result)}`);
  }
}

function walkFiles(root, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path));
    else fail(CODES.BUNDLE_STRUCTURE_INVALID, `bundle lib entry is not a regular file: ${relative(root, path)}`);
  }
  return files.sort();
}

function verifyBundleReceipt(bundleRoot, identity) {
  const path = join(bundleRoot, 'lib', 'hermes-profile-provenance.json');
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(CODES.RECEIPT_MISMATCH, `Hermes profile-provenance receipt is not valid JSON: ${error.message}`);
  }
  const mismatches = [];
  if (receipt?.schema !== 'ibex/hermes-profile-provenance-receipt/2') mismatches.push('schema');
  if (receipt?.origin?.cacheKey !== identity.cacheKey) mismatches.push('origin.cacheKey');
  if (receipt?.origin?.reviewedProfileIdentity?.sourceCommit !== identity.hermesSourceCommit) {
    mismatches.push('origin.reviewedProfileIdentity.sourceCommit');
  }
  if (receipt?.origin?.reviewedProfileIdentity?.patchStackDigest !== identity.patchStackDigest) {
    mismatches.push('origin.reviewedProfileIdentity.patchStackDigest');
  }
  if (mismatches.length > 0) {
    fail(CODES.RECEIPT_MISMATCH, `Hermes profile-provenance receipt mismatch: ${mismatches.join(', ')}`);
  }
  return receipt;
}

function probeSymbol(library, { runCommand, env, notice }) {
  const result = runCommand('nm', ['-D', library], { encoding: 'utf8', env });
  if (!succeeded(result)) {
    notice(`Skipped Linux Hermes symbol probe because host nm could not parse ${basename(library)}.`);
    return { checked: false };
  }
  if (!/(?:^|\s)ex_hermes_vm_current_package_id(?:$|\s)/mu.test(String(result.stdout))) {
    fail(CODES.SYMBOL_MISSING, 'lib/libhermesvm.so lacks ex_hermes_vm_current_package_id');
  }
  return { checked: true };
}

export function verifyHermesBundle({
  paths,
  identity,
  runCommand = defaultRunCommand,
  env = process.env,
  temporaryRoot = tmpdir(),
  offlineAttestation = false,
  notice = () => {},
}) {
  const tarballSha256 = verifyChecksum(paths);
  verifyAttestation(paths, { runCommand, env, offline: offlineAttestation });
  const unpacked = mkdtempSync(join(temporaryRoot, 'snapback-hermes-bundle-'));
  try {
    checked(
      runCommand,
      'tar',
      ['-xzf', paths.tarball, '-C', unpacked],
      { encoding: 'utf8', env },
      CODES.BUNDLE_STRUCTURE_INVALID,
      'could not unpack the Hermes release bundle',
    );
    for (const required of REQUIRED_BUNDLE_PATHS) {
      const path = join(unpacked, required);
      if (!existsSync(path) || !statSync(path).isFile()) {
        fail(CODES.BUNDLE_STRUCTURE_INVALID, `Hermes release bundle is missing ${required}`);
      }
    }
    verifyBundleReceipt(unpacked, identity);
    probeSymbol(join(unpacked, 'lib', 'libhermesvm.so'), { runCommand, env, notice });
    const prebuiltLib = walkFiles(join(unpacked, 'lib')).map((file) => ({
      file: `lib/${file}`,
      sha256: sha256File(join(unpacked, 'lib', file)),
    }));
    return { unpacked, tarballSha256, prebuiltLib, cleanup: () => rmSync(unpacked, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(unpacked, { recursive: true, force: true });
    throw error;
  }
}

function stagedReleaseFiles(stagingDir) {
  if (!existsSync(stagingDir)) return [];
  return readdirSync(stagingDir).filter((name) => RELEASE_ASSET.test(name)).sort();
}

function removeStaleAssets(stagingDir, expectedNames, report) {
  const removed = [];
  for (const name of stagedReleaseFiles(stagingDir)) {
    if (expectedNames.has(name)) continue;
    rmSync(join(stagingDir, name));
    removed.push(name);
    report(`Removed stale Hermes carrier ${name}.`);
  }
  return removed;
}

function assertNoStaleAssets(stagingDir, expectedNames) {
  const stale = stagedReleaseFiles(stagingDir).filter((name) => !expectedNames.has(name));
  if (stale.length > 0) {
    fail(CODES.STALE_ASSET_PRESENT, `staged Hermes carrier does not match current identity: ${stale.join(', ')}`);
  }
}

function downloadRelease({ directory, tag, assetName, repo, runCommand, env }) {
  const auth = runCommand('gh', ['auth', 'status'], { encoding: 'utf8', env });
  if (!succeeded(auth)) {
    fail(CODES.ATTESTATION_TOOL_UNAVAILABLE, `GitHub CLI is missing or unauthenticated: ${output(auth)}`);
  }
  const result = runCommand('gh', [
    'release', 'download', tag,
    '--repo', repo,
    '--pattern', assetName,
    '--pattern', `${assetName}.sha256`,
    '--pattern', `${assetName}.sigstore.json`,
    '--dir', directory,
  ], { encoding: 'utf8', env });
  if (!succeeded(result)) {
    if (ghUnavailable(result)) {
      fail(CODES.ATTESTATION_TOOL_UNAVAILABLE, `GitHub release access is unavailable: ${output(result)}`);
    }
    fail(CODES.RELEASE_ASSET_MISSING, `could not resolve exact Hermes release asset ${assetName}: ${output(result)}`);
  }
}

function parseStagingReceipt(path, expected) {
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(CODES.RECEIPT_MISMATCH, `staging receipt is unavailable or invalid: ${error.message}`);
  }
  for (const [field, value] of Object.entries(expected)) {
    if (receipt?.[field] !== value) {
      fail(CODES.RECEIPT_MISMATCH, `staging receipt ${field} does not match the current Hermes carrier`);
    }
  }
  if (
    receipt?.attestation?.verified !== true
    || receipt.attestation.repo !== ATTESTATION.repo
    || receipt.attestation.signerWorkflow !== ATTESTATION.signerWorkflow
    || receipt.attestation.sourceRef !== ATTESTATION.sourceRef
  ) {
    fail(CODES.RECEIPT_MISMATCH, 'staging receipt attestation facts do not match reviewed authorities');
  }
  return receipt;
}

export function stageLinuxHermesRelease({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  runCommand = defaultRunCommand,
  env = process.env,
  paths = {},
  check = false,
  prebuiltLib = false,
  now = () => new Date(),
  report = (message) => process.stdout.write(`${message}\n`),
  notice = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  const stagingDir = paths.stagingDir
    ?? join(root, 'demos', 'competitive-checkpoint', 'acceptance', 'drill', 'hermes');
  const prebuiltDir = paths.prebuiltDir
    ?? join(root, 'demos', 'competitive-checkpoint', 'acceptance', 'drill', 'prebuilt');
  const temporaryRoot = paths.temporaryRoot ?? tmpdir();
  const identity = deriveHermesIdentity({
    root,
    runCommand,
    env,
    ibexPath: paths.ibexPath,
    temporaryRoot,
  });
  const repo = env.IBEX_HERMES_ARTIFACT_REPO || 'expo/ibex';
  const releaseTag = `hermes-${identity.identity}`;
  const assetName = `hermes-linux-x64-${identity.identity}-static-v1.tar.gz`;
  const expectedNames = new Set([assetName, `${assetName}.sha256`, `${assetName}.sigstore.json`]);
  mkdirSync(stagingDir, { recursive: true });

  let sourceDir;
  let downloadScratch;
  if (check) {
    assertNoStaleAssets(stagingDir, expectedNames);
    sourceDir = stagingDir;
  } else {
    downloadScratch = mkdtempSync(join(temporaryRoot, 'snapback-hermes-release-'));
    sourceDir = downloadScratch;
    downloadRelease({ directory: sourceDir, tag: releaseTag, assetName, repo, runCommand, env });
  }

  let verified;
  try {
    const releasePaths = ensureReleaseFiles(sourceDir, assetName);
    verified = verifyHermesBundle({
      paths: releasePaths,
      identity,
      runCommand,
      env,
      temporaryRoot,
      offlineAttestation: check,
      notice,
    });
    const receiptFacts = {
      schema: 'snapback/hermes-carrier-staging-receipt/1',
      ibexCommit: identity.gitlink,
      hermesSourceCommit: identity.hermesSourceCommit,
      patchStackDigest: identity.patchStackDigest,
      identity: identity.identity,
      releaseTag,
      assetName,
      tarballSha256: verified.tarballSha256,
    };
    let receipt;
    let removed = [];
    if (check) {
      receipt = parseStagingReceipt(join(stagingDir, 'staging-receipt.json'), receiptFacts);
      if (JSON.stringify(receipt.prebuiltLib) !== JSON.stringify(verified.prebuiltLib)) {
        fail(CODES.RECEIPT_MISMATCH, 'staging receipt prebuiltLib digests do not match the bundle');
      }
      report(`Verified staged Hermes carrier ${assetName}.`);
    } else {
      removed = removeStaleAssets(stagingDir, expectedNames, report);
      for (const name of expectedNames) copyFileSync(join(sourceDir, name), join(stagingDir, name));
      receipt = {
        ...receiptFacts,
        stagedAt: now().toISOString(),
        attestation: { verified: true, ...ATTESTATION },
        prebuiltLib: verified.prebuiltLib,
      };
      writeFileSync(join(stagingDir, 'staging-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
      report(`Staged verified Hermes carrier ${assetName}.`);
    }

    const checksumLines = verified.prebuiltLib.map(({ file, sha256 }) => `${sha256}  ${file}`);
    if (prebuiltLib) {
      const target = join(prebuiltDir, 'lib');
      rmSync(target, { recursive: true, force: true });
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(verified.unpacked, 'lib'), target, { recursive: true });
      for (const line of checksumLines) report(line);
    }
    return { identity, receipt, removed, checksumLines };
  } finally {
    verified?.cleanup();
    if (downloadScratch) rmSync(downloadScratch, { recursive: true, force: true });
  }
}

export function parseArguments(argv) {
  let check = false;
  let prebuiltLib = false;
  for (const argument of argv) {
    if (argument === '--check' && !check) check = true;
    else if (argument === '--prebuilt-lib' && !prebuiltLib) prebuiltLib = true;
    else fail(CODES.ARGUMENT_INVALID, `unknown or duplicate argument: ${argument}`);
  }
  return { check, prebuiltLib };
}

export function main(argv = process.argv.slice(2)) {
  return stageLinuxHermesRelease(parseArguments(argv));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const code = typeof error?.code === 'string'
      ? error.code
      : CODES.IDENTITY_DERIVATION_FAILED;
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exit(1);
  }
}
