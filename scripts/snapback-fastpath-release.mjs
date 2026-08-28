#!/usr/bin/env node

// @ref LLP 0041#fast-path-pre-consumer-release-2026-08-01 — encode the
// author-approved fast path as a resumable two-pass, holding-tagged ceremony.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPublicationCapabilityQualificationMatrix,
  assertStagedRuntimeAdminConsole,
  assertStagedRuntimeStoreQualification,
  readPublicationCapabilityQualificationFile,
} from './publication-store-qualification-gate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
export const RUNTIME_PLATFORMS = Object.freeze(['darwin-arm64', 'linux-x64']);
const RECEIPT_ENVIRONMENT = Object.freeze({
  'darwin-arm64': 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE',
  'linux-x64': 'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
});
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*)(?:\.(?:[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*|0|[1-9]\d*))*)?$/u;

function codedError(code, message, details = undefined) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function exactSemver(version) {
  return EXACT_SEMVER.test(version);
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `${flag} requires a value`);
  }
  return value;
}

function parseReceiptArgument(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw codedError(
      'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
      '--receipt must have the form <platform>=<path>',
    );
  }
  return [value.slice(0, separator), resolve(value.slice(separator + 1))];
}

export function assertReceiptMatrix(receipts, runtimePlatforms = RUNTIME_PLATFORMS) {
  const missing = runtimePlatforms.filter((platform) => !receipts.has(platform));
  const extra = [...receipts.keys()].filter((platform) => !runtimePlatforms.includes(platform));
  if (missing.length > 0 || extra.length > 0 || receipts.size !== runtimePlatforms.length) {
    throw codedError(
      'SNAPBACK_FASTPATH_STORE_RECEIPT_MISSING',
      `release requires exactly one store receipt for each runtime platform; missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`,
    );
  }
  return receipts;
}

export function assertHoldingTag(tag) {
  if (tag === 'latest' || !/^fastpath-\d+-\d+-\d+(?:-[0-9A-Za-z.-]+)?-[0-9a-f]{12}$/.test(tag)) {
    throw codedError(
      'SNAPBACK_FASTPATH_HOLDING_TAG_INVALID',
      `holding tag must be an immutable fastpath tag and never latest, observed ${tag}`,
    );
  }
  return tag;
}

export function deriveHoldingTag(version, revision) {
  if (!exactSemver(version) || !/^[0-9a-f]{12,64}$/.test(revision)) {
    throw codedError(
      'SNAPBACK_FASTPATH_HOLDING_TAG_INVALID',
      'holding tag requires an exact semantic version and a hexadecimal source revision',
    );
  }
  const dashedVersion = version.replace(/[^0-9A-Za-z]+/gu, '-');
  return assertHoldingTag(`fastpath-${dashedVersion}-${revision.slice(0, 12)}`);
}

export function parseArguments(argv) {
  const subcommand = argv[0];
  if (!['stage', 'release', 'preflight'].includes(subcommand)) {
    throw codedError(
      'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
      'first argument must be stage, release, or preflight',
    );
  }
  const options = {
    subcommand,
    version: null,
    out: null,
    runtimePlatforms: 'all',
    receipts: new Map(),
    retainLedger: null,
    publish: false,
    otp: null,
    isolateWorktree: subcommand !== 'preflight',
    help: false,
  };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--isolate-worktree' || argument === '--no-isolate-worktree') {
      if (subcommand === 'preflight') {
        throw codedError(
          'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
          `${argument} is not valid for preflight`,
        );
      }
      if (seen.has('isolate-worktree')) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `duplicate ${argument}`);
      }
      seen.add('isolate-worktree');
      options.isolateWorktree = argument === '--isolate-worktree';
      continue;
    }
    if (argument === '--publish') {
      if (subcommand !== 'release' || seen.has(argument)) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `invalid or duplicate ${argument}`);
      }
      seen.add(argument);
      options.publish = true;
      continue;
    }
    if (argument === '--receipt') {
      if (subcommand !== 'release') {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', '--receipt is release-only');
      }
      const value = takeValue(argv, index, argument);
      index += 1;
      const [platform, path] = parseReceiptArgument(value);
      if (options.receipts.has(platform)) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `duplicate receipt for ${platform}`);
      }
      options.receipts.set(platform, path);
      continue;
    }
    if (['--version', '--out', '--runtime-platforms', '--retain-ledger', '--otp']
      .includes(argument)) {
      if (seen.has(argument)) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `duplicate ${argument}`);
      }
      seen.add(argument);
      const value = takeValue(argv, index, argument);
      index += 1;
      if (argument === '--version') options.version = value;
      else if (argument === '--out') options.out = resolve(value);
      else if (argument === '--runtime-platforms') options.runtimePlatforms = value;
      else if (argument === '--retain-ledger') options.retainLedger = resolve(value);
      else options.otp = value;
      continue;
    }
    throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', `unrecognized argument: ${argument}`);
  }
  if (!options.help) {
    if (subcommand === 'preflight') {
      if (
        options.version
        || seen.has('--out')
        || seen.has('--runtime-platforms')
        || options.publish
        || options.receipts.size > 0
        || options.retainLedger
        || options.otp
      ) {
        throw codedError(
          'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
          'preflight inspects cleanliness and HEAD only',
        );
      }
      return options;
    }
    if (!exactSemver(options.version ?? '')) {
      throw codedError(
        'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
        `--version must be an exact semantic version, observed ${options.version ?? 'absent'}`,
      );
    }
    options.out ??= join(ROOT, 'dist-publish', `fastpath-${options.version}`);
    if (subcommand === 'stage') {
      if (options.runtimePlatforms !== 'all') {
        throw codedError(
          'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
          '--runtime-platforms must be all for fast-path staging',
        );
      }
      if (options.publish || options.receipts.size > 0 || options.retainLedger || options.otp) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', 'release-only options passed to stage');
      }
    } else {
      if (seen.has('--runtime-platforms')) {
        throw codedError('SNAPBACK_FASTPATH_ARGUMENT_INVALID', '--runtime-platforms is stage-only');
      }
      assertReceiptMatrix(options.receipts);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? MAX_COMMAND_OUTPUT_BYTES,
    timeout: options.timeout ?? 360_000,
  });
}

function runOrThrow(command, args, { code, message, run: runCommand = run, ...options }) {
  const result = runCommand(command, args, options);
  if (result.error || result.status !== 0) {
    throw codedError(
      code,
      `${message} (${result.signal ?? result.status ?? result.error?.message})`,
      {
        stdout: result.stdout?.slice(-32_768),
        stderr: result.stderr?.slice(-32_768),
      },
    );
  }
  return result;
}

function gitPorcelain({ cwd = ROOT, run: runCommand = run } = {}) {
  const status = runOrThrow('git', ['status', '--porcelain'], {
    code: 'SNAPBACK_FASTPATH_DIRTY_TREE',
    message: 'could not inspect source tree',
    cwd,
    run: runCommand,
  });
  return {
    dirty: status.stdout.trim().length > 0,
    porcelain: status.stdout,
  };
}

export function headRevision({ cwd = ROOT, run: runCommand = run } = {}) {
  return runOrThrow('git', ['rev-parse', 'HEAD'], {
    code: 'SNAPBACK_FASTPATH_LEDGER_INVALID',
    message: 'could not resolve the source revision',
    cwd,
    run: runCommand,
  }).stdout.trim();
}

export function inspectSourceTree(options = {}) {
  const status = gitPorcelain(options);
  return {
    ...status,
    revision: headRevision(options),
  };
}

export function assertCleanTree(options = {}) {
  const status = gitPorcelain(options);
  if (status.dirty) {
    throw codedError(
      'SNAPBACK_FASTPATH_DIRTY_TREE',
      'fast-path release requires a clean source tree',
    );
  }
  return status;
}

export function preflight(options = {}, deps = {}) {
  const tree = inspectSourceTree({
    cwd: options.cwd ?? deps.cwd ?? ROOT,
    run: deps.run ?? run,
  });
  if (tree.dirty) {
    throw codedError(
      'SNAPBACK_FASTPATH_DIRTY_TREE',
      'fast-path release requires a clean source tree',
      { revision: tree.revision, porcelain: tree.porcelain },
    );
  }
  return {
    schemaVersion: 'snapback.fastpath-preflight.v1',
    ok: true,
    revision: tree.revision,
    dirty: false,
  };
}

function retainedWorktreeDiagnostic(worktree) {
  return {
    code: 'SNAPBACK_FASTPATH_ISOLATED_WORKTREE_RETAINED',
    severity: 'error',
    subsystem: 'publish',
    message: `isolated worktree retained at ${worktree.path}; remove with: git worktree remove --force ${JSON.stringify(worktree.path)}`,
  };
}

export function ceremonyArgv(options) {
  const argv = [options.subcommand, '--version', options.version, '--out', options.out];
  if (options.subcommand === 'stage') {
    argv.push('--runtime-platforms', options.runtimePlatforms ?? 'all');
  } else {
    for (const [platform, path] of options.receipts ?? []) {
      argv.push('--receipt', `${platform}=${path}`);
    }
    if (options.retainLedger) argv.push('--retain-ledger', options.retainLedger);
    if (options.publish) argv.push('--publish');
    if (options.otp) argv.push('--otp', options.otp);
  }
  argv.push('--no-isolate-worktree');
  return argv;
}

export function provisionIsolatedWorktree({
  revision,
  cwd = ROOT,
  tmpDir = tmpdir(),
  run: runCommand = run,
} = {}) {
  if (!/^[0-9a-f]{7,64}$/i.test(revision ?? '')) {
    throw codedError(
      'SNAPBACK_FASTPATH_WORKTREE_PROVISION_FAILED',
      `isolated worktree requires a hexadecimal HEAD revision, observed ${revision ?? 'absent'}`,
    );
  }
  const directory = mkdtempSync(join(tmpDir, 'snapback-fastpath-'));
  rmSync(directory, { recursive: true, force: true });
  try {
    // @ref LLP 0041#isolated-worktrees-2026-08-12 — never bootstrap or
    // qualify against the invoking checkout; the shared primary tree is
    // routinely dirty and that dirt is not the release bytes.
    runOrThrow('git', [
      '-c', 'core.hooksPath=/dev/null',
      'worktree', 'add', '--detach', '--quiet', directory, revision,
    ], {
      code: 'SNAPBACK_FASTPATH_WORKTREE_PROVISION_FAILED',
      message: `could not provision an isolated worktree at ${revision}`,
      cwd,
      run: runCommand,
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const isolated = inspectSourceTree({ cwd: directory, run: runCommand });
  if (isolated.dirty || isolated.revision !== revision) {
    throw codedError(
      'SNAPBACK_FASTPATH_WORKTREE_PROVISION_FAILED',
      `isolated worktree at ${directory} is not a clean checkout of ${revision}`,
      { isolated, path: directory },
    );
  }
  // The staging build runs workspace node scripts that import third-party
  // dependencies (e.g. `ajv` from scripts/symbol-lifecycle.mjs). The isolated
  // worktree lives outside the primary tree and cannot resolve `node_modules`
  // upward, so install the locked dependencies hermetically here. `--frozen-
  // lockfile` keeps the release build reproducible (and fails loudly on lockfile
  // drift), and `node_modules` is gitignored so it does not dirty the checkout
  // whose cleanliness was just verified above.
  runOrThrow('bun', ['install', '--frozen-lockfile'], {
    code: 'SNAPBACK_FASTPATH_WORKTREE_PROVISION_FAILED',
    message: `could not install locked dependencies in isolated worktree at ${directory}`,
    cwd: directory,
    run: runCommand,
  });
  return { path: directory, revision };
}

export function teardownIsolatedWorktree({
  path,
  cwd = ROOT,
  run: runCommand = run,
} = {}) {
  try {
    runOrThrow('git', ['worktree', 'remove', '--force', path], {
      code: 'SNAPBACK_FASTPATH_WORKTREE_TEARDOWN_FAILED',
      message: `could not remove isolated worktree at ${path}`,
      cwd,
      run: runCommand,
    });
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
}

function splitTrailingJson(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      return { prefix: lines.slice(0, index).join('\n'), value: JSON.parse(line) };
    } catch {
      // keep scanning; ceremony children may chatter on stdout
    }
  }
  return { prefix: stdout ?? '', value: null };
}

export function defaultContinueInWorktree({
  worktree,
  options,
  execPath = process.execPath,
  spawn = spawnSync,
} = {}) {
  const script = join(worktree.path, 'scripts', 'snapback-fastpath-release.mjs');
  const result = spawn(execPath, [script, ...ceremonyArgv(options)], {
    cwd: worktree.path,
    env: { ...process.env, SNAPBACK_FASTPATH_ISOLATED_WORKTREE: worktree.path },
    encoding: 'utf8',
    maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    timeout: 7_200_000,
  });
  const split = splitTrailingJson(result.stdout);
  if (split.prefix) {
    process.stdout.write(split.prefix.endsWith('\n') ? split.prefix : `${split.prefix}\n`);
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || split.value == null) {
    throw codedError(
      'SNAPBACK_FASTPATH_ISOLATE_FAILED',
      `isolated ceremony failed (${result.signal ?? result.status ?? result.error?.message})`,
      {
        stdout: result.stdout?.slice(-32_768),
        stderr: result.stderr?.slice(-32_768),
        isolatedWorktree: { path: worktree.path, revision: worktree.revision, retained: true },
      },
    );
  }
  const parsed = split.value;
  return {
    ...parsed,
    ok: parsed.ok === true && result.status === 0,
  };
}

function retainWorktreeResult(result, worktree) {
  const isolatedWorktree = { path: worktree.path, revision: worktree.revision, retained: true };
  const diagnostic = retainedWorktreeDiagnostic(worktree);
  if (result && typeof result === 'object') {
    return {
      ...result,
      ok: false,
      isolatedWorktree,
      diagnostics: [...(result.diagnostics ?? []), diagnostic],
    };
  }
  return { ok: false, isolatedWorktree, diagnostics: [diagnostic] };
}

export async function runCeremony(options, deps = {}) {
  const cwd = deps.cwd ?? ROOT;
  const runCommand = deps.run ?? run;
  const isolateWorktree = options.isolateWorktree !== false;

  // Cleanliness is the first side-effecting check. Isolate may proceed
  // from a dirty invoking tree; --no-isolate-worktree still refuses here
  // before any publish, qualification, or bootstrap spawn.
  const status = gitPorcelain({ cwd, run: runCommand });
  if (status.dirty && !isolateWorktree) {
    throw codedError(
      'SNAPBACK_FASTPATH_DIRTY_TREE',
      'fast-path release requires a clean source tree',
    );
  }

  if (!isolateWorktree) {
    return options.subcommand === 'release'
      ? releasePass(options, { cwd, run: runCommand })
      : stagePass(options, { cwd, run: runCommand });
  }

  const revision = (deps.headRevision ?? headRevision)({ cwd, run: runCommand });
  const worktree = (deps.provisionIsolatedWorktree ?? provisionIsolatedWorktree)({
    revision,
    cwd,
    run: runCommand,
  });
  try {
    const result = await (deps.continueInWorktree ?? defaultContinueInWorktree)({
      worktree,
      options,
      invoking: { cwd, dirty: status.dirty, revision },
    });
    if (result?.ok === true) {
      try {
        (deps.teardownIsolatedWorktree ?? teardownIsolatedWorktree)({
          path: worktree.path,
          cwd,
          run: runCommand,
        });
        return {
          ...result,
          isolatedWorktree: { path: worktree.path, revision: worktree.revision, retained: false },
        };
      } catch (error) {
        return {
          ...result,
          isolatedWorktree: { path: worktree.path, revision: worktree.revision, retained: true },
          diagnostics: [
            ...(result.diagnostics ?? []),
            {
              code: error?.code ?? 'SNAPBACK_FASTPATH_WORKTREE_TEARDOWN_FAILED',
              severity: 'warning',
              subsystem: 'publish',
              message: error?.message ?? String(error),
            },
          ],
        };
      }
    }
    return retainWorktreeResult(result, worktree);
  } catch (error) {
    error.details = {
      ...(error.details ?? {}),
      isolatedWorktree: { path: worktree.path, revision: worktree.revision, retained: true },
    };
    throw error;
  }
}

function readBoundedJson(path, label) {
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size > MAX_LEDGER_BYTES) {
    throw codedError('SNAPBACK_FASTPATH_LEDGER_INVALID', `${label} is not a bounded regular file`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw codedError('SNAPBACK_FASTPATH_LEDGER_INVALID', `${label} is invalid JSON: ${error.message}`);
  }
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function tarballVector(stagedDir, ledger) {
  const vector = [];
  for (const row of ledger.packages ?? []) {
    const sha256 = await sha256File(join(stagedDir, row.tarball));
    if (sha256 !== row.sha256) {
      throw codedError(
        'SNAPBACK_FASTPATH_LEDGER_INVALID',
        `staged tarball bytes drifted for ${row.name}`,
      );
    }
    vector.push({ name: row.name, version: row.version, tarball: row.tarball, sha256 });
  }
  return vector;
}

function publicationEnvironment(receipts = null, { allowMissing = false } = {}) {
  const environment = { ...process.env };
  delete environment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS;
  delete environment.SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE;
  delete environment.SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT;
  if (allowMissing) environment.SNAPBACK_ALLOW_MISSING_STORE_RECEIPTS = '1';
  if (receipts) {
    for (const [platform, path] of receipts) {
      environment[RECEIPT_ENVIRONMENT[platform]] = path;
    }
  }
  return environment;
}

export async function stagePass(options, deps = {}) {
  assertCleanTree({ cwd: deps.cwd ?? ROOT, run: deps.run ?? run });
  const pass1 = `${options.out}-pass1`;
  const receiptsRoot = `${options.out}-receipts`;
  mkdirSync(pass1, { recursive: true });
  mkdirSync(receiptsRoot, { recursive: true });
  runOrThrow(process.execPath, [
    join(ROOT, 'scripts', 'snapback-publish.mjs'),
    '--version', options.version,
    '--runtime-platforms', 'all',
    '--out', pass1,
  ], {
    code: 'SNAPBACK_FASTPATH_PASS1_FAILED',
    message: 'receiptless pass-1 staging failed',
    env: publicationEnvironment(null, { allowMissing: true }),
    timeout: 900_000,
  });
  const ledger = readBoundedJson(join(pass1, 'publish-ledger.json'), 'pass-1 publish ledger');
  const vector = await tarballVector(pass1, ledger);
  const host = `${process.platform}-${process.arch}`;
  if (!RUNTIME_PLATFORMS.includes(host)) {
    throw codedError(
      'SNAPBACK_FASTPATH_HOST_UNSUPPORTED',
      `host ${host} is not in the runtime qualification matrix`,
    );
  }
  const hostReceipt = join(receiptsRoot, `${host}-store.json`);
  runOrThrow(process.execPath, [
    join(ROOT, 'scripts', 'qualified-staging-store-qualification.mjs'),
    '--staged-dir', pass1,
    '--platform', host,
    '--out', hostReceipt,
  ], {
    code: 'SNAPBACK_FASTPATH_STORE_QUALIFICATION_FAILED',
    message: `host store qualification failed for ${host}`,
    timeout: 900_000,
  });
  const other = RUNTIME_PLATFORMS.find((platform) => platform !== host);
  const remoteReceipt = join(receiptsRoot, `${other}-store.json`);
  const remoteCommand = [
    'node',
    'scripts/qualified-staging-store-qualification.mjs',
    '--staged-dir', pass1,
    '--platform', other,
    '--out', remoteReceipt,
  ];
  return {
    schemaVersion: 'snapback.fastpath-stage.v1',
    ok: true,
    version: options.version,
    revision: ledger.revision,
    pass1,
    receiptsRoot,
    hostPlatform: host,
    hostReceipt,
    otherPlatform: other,
    remoteMint: {
      cwd: ROOT,
      argv: remoteCommand,
      command: remoteCommand.map((part) => JSON.stringify(part)).join(' '),
    },
    tarballs: vector,
  };
}

function registryVersionExists(name, version) {
  const result = run('npm', [
    'view', `${name}@${version}`, 'version', '--json', '--registry', DEFAULT_REGISTRY,
  ]);
  if (result.status === 0) return true;
  if (/E404|404 Not Found/u.test(`${result.stdout}\n${result.stderr}`)) return false;
  throw codedError(
    'SNAPBACK_FASTPATH_REGISTRY_PROBE_FAILED',
    `registry probe failed for ${name}@${version}`,
    { stdout: result.stdout?.slice(-32_768), stderr: result.stderr?.slice(-32_768) },
  );
}

export const EXACT_VERSION_PROPAGATION_WALL_BOUND_MS = 300_000;
export const EXACT_VERSION_PROPAGATION_POLL_MS = 5_000;

const sleep = (milliseconds) => new Promise((settle) => setTimeout(settle, milliseconds));

// @ref LLP 0041#amendment-2026-08-09-the-fast-path-is-a-script-and-it-is-gated
// — the post-publish smoke installs by exact version, so it must not start
// before the registry's read path can serve those versions.
export async function awaitExactVersionPropagation(packages, {
  deadlineMs = EXACT_VERSION_PROPAGATION_WALL_BOUND_MS,
  pollMs = EXACT_VERSION_PROPAGATION_POLL_MS,
  exists = registryVersionExists,
  now = () => Date.now(),
  wait = sleep,
} = {}) {
  const startedAt = now();
  const deadline = startedAt + deadlineMs;
  const pending = new Map(packages.map((row) => [row.name, row.version]));
  const resolved = [];
  for (;;) {
    for (const [name, version] of [...pending]) {
      if (exists(name, version)) {
        pending.delete(name);
        resolved.push({ name, version, resolvedAfterMs: now() - startedAt });
      }
    }
    if (pending.size === 0) {
      return { ok: true, waitedMs: now() - startedAt, resolved };
    }
    if (now() >= deadline) {
      throw codedError(
        'SNAPBACK_FASTPATH_REGISTRY_PROPAGATION_TIMEOUT',
        `published versions were still unresolvable after ${deadlineMs}ms: `
          + [...pending].map(([name, version]) => `${name}@${version}`).join(', '),
        { pending: [...pending].map(([name, version]) => ({ name, version })) },
      );
    }
    await wait(pollMs);
  }
}

function npmArgsWithOtp(args, otp) {
  return otp ? [...args, '--otp', otp] : args;
}

function setDistTag(name, version, tag, otp) {
  assertHoldingTag(tag);
  runOrThrow('npm', npmArgsWithOtp([
    'dist-tag', 'add', `${name}@${version}`, tag, '--registry', DEFAULT_REGISTRY,
  ], otp), {
    code: 'SNAPBACK_FASTPATH_PUBLISH_FAILED',
    message: `could not set holding tag ${tag} for ${name}@${version}`,
  });
}

function viewDistTag(name, tag) {
  const result = runOrThrow('npm', [
    'view', name, `dist-tags.${tag}`, '--json', '--registry', DEFAULT_REGISTRY,
  ], {
    code: 'SNAPBACK_FASTPATH_REGISTRY_PROBE_FAILED',
    message: `could not read ${name} dist-tag ${tag}`,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return result.stdout.trim();
  }
}

async function downloadAndVerify(row, stagedDir) {
  const temporary = mkdtempSync(join(tmpdir(), 'snapback-fastpath-registry-'));
  try {
    const packed = runOrThrow('npm', [
      'pack', `${row.name}@${row.version}`,
      '--pack-destination', temporary,
      '--json', '--ignore-scripts',
      '--registry', DEFAULT_REGISTRY,
    ], {
      code: 'SNAPBACK_FASTPATH_REGISTRY_BYTES_DRIFTED',
      message: `could not redownload ${row.name}@${row.version}`,
      timeout: 360_000,
    });
    let record;
    try {
      record = JSON.parse(packed.stdout)[0];
    } catch (error) {
      throw codedError(
        'SNAPBACK_FASTPATH_REGISTRY_BYTES_DRIFTED',
        `npm pack returned invalid metadata for ${row.name}: ${error.message}`,
      );
    }
    const registrySha256 = await sha256File(join(temporary, record.filename));
    const stagedSha256 = await sha256File(join(stagedDir, row.tarball));
    if (registrySha256 !== row.sha256 || stagedSha256 !== row.sha256) {
      throw codedError(
        'SNAPBACK_FASTPATH_REGISTRY_BYTES_DRIFTED',
        `registry bytes differ from staged bytes for ${row.name}@${row.version}`,
      );
    }
    return {
      name: row.name,
      version: row.version,
      sha256: row.sha256,
      registrySha256,
      integrity: record.integrity ?? null,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function parseSmokeReceipt(result) {
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  try {
    return JSON.parse(lines.at(-1));
  } catch (error) {
    throw codedError(
      'SNAPBACK_FASTPATH_POST_PUBLISH_SMOKE_FAILED',
      `published closure smoke did not emit a receipt: ${error.message}`,
      { stdout: result.stdout?.slice(-32_768), stderr: result.stderr?.slice(-32_768) },
    );
  }
}

function ceremonyPath(out) {
  return join(out, 'fastpath-release-ceremony.json');
}

function writeCeremony(out, ceremony) {
  const path = ceremonyPath(out);
  writeFileSync(path, `${JSON.stringify(ceremony, null, 2)}\n`);
  return path;
}

export async function releasePass(options, deps = {}) {
  assertCleanTree({ cwd: deps.cwd ?? ROOT, run: deps.run ?? run });
  for (const [platform, path] of options.receipts) {
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw codedError(
        'SNAPBACK_FASTPATH_STORE_RECEIPT_MISSING',
        `store receipt for ${platform} is not a regular file at ${path}`,
      );
    }
  }
  mkdirSync(options.out, { recursive: true });
  const ledgerPath = join(options.out, 'publish-ledger.json');
  // Resumability. Pass-2 staging ends in `npm publish --dry-run`, which npm
  // refuses once the version exists ("cannot publish over the previously
  // published versions"). A ceremony interrupted after publishing — the
  // 0.1.17 cut was, by its own smoke gate — could therefore never be resumed
  // to promote `latest`. Reuse an existing pass-2 closure that already binds
  // this exact version and source revision instead of restaging it. The gate
  // below still runs over the reused bytes, so reuse never skips the check.
  const reusable = existsSync(ledgerPath)
    && (() => {
      const existing = readBoundedJson(ledgerPath, 'existing pass-2 publish ledger');
      return existing.version === options.version
        && existing.revision === headRevision()
        && existing.sourceDirty === false;
    })();
  if (!reusable) {
    runOrThrow(process.execPath, [
      join(ROOT, 'scripts', 'snapback-publish.mjs'),
      '--version', options.version,
      '--runtime-platforms', 'all',
      '--out', options.out,
    ], {
      code: 'SNAPBACK_FASTPATH_PASS2_FAILED',
      message: 'receipt-bearing pass-2 staging failed',
      env: publicationEnvironment(options.receipts),
      timeout: 900_000,
    });
  }
  const ledger = readBoundedJson(ledgerPath, 'pass-2 publish ledger');
  if (ledger.version !== options.version
      || ledger.sourceDirty !== false
      || ledger.runtimePlatforms?.length !== RUNTIME_PLATFORMS.length) {
    throw codedError(
      'SNAPBACK_FASTPATH_LEDGER_INVALID',
      'pass-2 ledger does not bind the clean exact version and full runtime matrix',
    );
  }
  const capabilityQualification = assertPublicationCapabilityQualificationMatrix({
    ledger,
    qualifications: RUNTIME_PLATFORMS.map((platform) => (
      readPublicationCapabilityQualificationFile(options.receipts.get(platform), platform)
    )),
  });
  const gateSummary = assertStagedRuntimeStoreQualification({
    stagedDir: options.out,
    ledger,
  });
  const adminConsoleSummary = assertStagedRuntimeAdminConsole({
    stagedDir: options.out,
    ledger,
  });
  const ledgerSha256 = await sha256File(ledgerPath);
  let retainedLedger = null;
  if (options.retainLedger) {
    mkdirSync(dirname(options.retainLedger), { recursive: true });
    copyFileSync(ledgerPath, options.retainLedger);
    retainedLedger = {
      path: options.retainLedger,
      sha256: await sha256File(options.retainLedger),
    };
  }
  const holdingTag = deriveHoldingTag(options.version, ledger.revision);
  const ceremony = {
    schemaVersion: 'snapback.fastpath-release-ceremony.v1',
    ok: false,
    mode: options.publish ? 'publish' : 'rehearsal',
    version: options.version,
    revision: ledger.revision,
    registry: DEFAULT_REGISTRY,
    holdingTag,
    ledgerSha256,
    retainedLedger,
    gateSummary,
    capabilityQualification: capabilityQualification.map((entry) => ({
      platform: entry.platform,
      runtimeBinarySha256: entry.runtimeBinarySha256,
      requiredCapabilities: entry.codegenRequiredCapabilities.length,
    })),
    adminConsoleSummary,
    publication: [],
    byteVerification: [],
    smokeReceipt: null,
    finalDistTags: [],
    diagnostics: [],
  };
  if (!options.publish) {
    ceremony.ok = true;
    ceremony.path = writeCeremony(options.out, ceremony);
    return ceremony;
  }
  try {
    if (process.env.SNAPBACK_FASTPATH_PUBLISH_CONFIRM !== 'yes-really') {
      throw codedError(
        'SNAPBACK_FASTPATH_PUBLISH_CONFIRMATION_REQUIRED',
        'real fast-path publication requires SNAPBACK_FASTPATH_PUBLISH_CONFIRM=yes-really',
      );
    }
    runOrThrow('npm', ['whoami', '--registry', DEFAULT_REGISTRY], {
      code: 'SNAPBACK_FASTPATH_NPM_AUTH_REQUIRED',
      message: 'npm authentication is required',
    });
    for (const row of ledger.packages) {
      if (registryVersionExists(row.name, row.version)) {
        ceremony.publication.push({
          name: row.name,
          version: row.version,
          status: 'skipped-already-published',
        });
        if (viewDistTag(row.name, holdingTag) !== row.version) {
          setDistTag(row.name, row.version, holdingTag, options.otp);
        }
      } else {
        runOrThrow('npm', npmArgsWithOtp([
          'publish', join(options.out, row.tarball),
          '--access', 'public',
          '--tag', holdingTag,
          '--registry', DEFAULT_REGISTRY,
        ], options.otp), {
          code: 'SNAPBACK_FASTPATH_PUBLISH_FAILED',
          message: `publication failed for ${row.name}@${row.version}`,
          timeout: 360_000,
        });
        ceremony.publication.push({
          name: row.name,
          version: row.version,
          status: 'published',
        });
      }
    }
    for (const row of ledger.packages) {
      ceremony.byteVerification.push(await downloadAndVerify(row, options.out));
    }
    // The registry's read replicas lag its write path by seconds. Byte
    // verification passes against the tarball URL while `npm install
    // <name>@<version>` still answers ETARGET from a stale packument, so an
    // immediate smoke reports a false INSTALL_FAILED for a closure that is
    // fine. Wait for every name to resolve by exact version before running it,
    // and keep the wait bounded so a genuinely absent version still fails.
    ceremony.propagation = await awaitExactVersionPropagation(
      ledger.packages,
      { deadlineMs: EXACT_VERSION_PROPAGATION_WALL_BOUND_MS },
    );
    const smoke = run(process.execPath, [
      join(ROOT, 'scripts', 'published-closure-boot-smoke.mjs'),
      '--version', options.version,
      '--registry', DEFAULT_REGISTRY,
    ], { timeout: 600_000 });
    ceremony.smokeReceipt = parseSmokeReceipt(smoke);
    if (smoke.error || smoke.status !== 0 || ceremony.smokeReceipt?.ok !== true) {
      throw codedError(
        'SNAPBACK_FASTPATH_POST_PUBLISH_SMOKE_FAILED',
        `published closure smoke failed; ${options.version} remains under ${holdingTag}. Remediate with a new patch version; do not move latest to this closure.`,
        { smokeReceipt: ceremony.smokeReceipt },
      );
    }
    for (const row of ledger.packages) {
      runOrThrow('npm', npmArgsWithOtp([
        'dist-tag', 'add', `${row.name}@${row.version}`, 'latest',
        '--registry', DEFAULT_REGISTRY,
      ], options.otp), {
        code: 'SNAPBACK_FASTPATH_LATEST_PROMOTION_INCOMPLETE',
        message: `could not promote latest for ${row.name}@${row.version}`,
      });
    }
    for (const row of ledger.packages) {
      const latest = viewDistTag(row.name, 'latest');
      ceremony.finalDistTags.push({ name: row.name, latest });
    }
    const incomplete = ceremony.finalDistTags.filter((entry) => entry.latest !== options.version);
    if (incomplete.length > 0) {
      throw codedError(
        'SNAPBACK_FASTPATH_LATEST_PROMOTION_INCOMPLETE',
        `latest promotion incomplete for ${incomplete.map((entry) => entry.name).join(', ')}`,
      );
    }
    ceremony.ok = true;
  } catch (error) {
    ceremony.diagnostics.push({
      code: error?.code ?? 'SNAPBACK_FASTPATH_RELEASE_FAILED',
      severity: 'error',
      subsystem: 'publish',
      message: error?.message ?? String(error),
      ...(error?.details === undefined ? {} : { details: error.details }),
    });
  }
  ceremony.path = writeCeremony(options.out, ceremony);
  return ceremony;
}

function usage() {
  return `usage:
  node scripts/snapback-fastpath-release.mjs preflight
  node scripts/snapback-fastpath-release.mjs stage --version <v> [--out <dir>] [--runtime-platforms all] [--isolate-worktree|--no-isolate-worktree]
  node scripts/snapback-fastpath-release.mjs release --version <v> [--out <dir>] --receipt <platform>=<path> [--receipt ...] [--retain-ledger <path>] [--publish] [--otp <code>] [--isolate-worktree|--no-isolate-worktree]
`;
}

// import.meta.main exists from Node 24.2.0; below that it is undefined and a
// direct CLI invocation would silently load as a plain module and exit 0 —
// the exact false-success shape this guard exists to prevent. Fail closed.
if (import.meta.main === undefined) {
  const error = new Error(
    'snapback-fastpath-release requires Node >= 24.2 (import.meta.main); '
    + `running ${process.version}`,
  );
  error.code = 'SNAPBACK_FASTPATH_NODE_UNSUPPORTED';
  throw error;
}

if (import.meta.main) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else if (options.subcommand === 'preflight') {
      const result = preflight(options);
      console.log(JSON.stringify(result));
    } else {
      const result = await runCeremony(options);
      console.log(JSON.stringify(result));
      if (result.ok !== true) process.exitCode = 1;
    }
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      diagnostics: [{
        code: error?.code ?? 'SNAPBACK_FASTPATH_RELEASE_FAILED',
        severity: 'error',
        subsystem: 'publish',
        message: error?.message ?? String(error),
        ...(error?.details === undefined ? {} : { details: error.details }),
      }],
    }));
    process.exitCode = 1;
  }
}
