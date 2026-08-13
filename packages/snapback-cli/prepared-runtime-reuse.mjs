#!/usr/bin/env node

// A prepared runtime may cross a commit boundary only when the binary's real
// build and qualification closure is unchanged. The ordinary runtime-readiness
// verifier remains the authority for binary/Hermes digest coherence; this
// module adds the source, toolchain, platform, and qualification-input binding
// needed by detached drift-gate worktrees.
//
// @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — source means the semantics-affecting closure, not exact
// commit identity, and reuse removes work without removing receipt proof.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyRuntimeReadinessReceipt } from './runtime-readiness.mjs';

export const PREPARED_RUNTIME_REUSE_SCHEMA_VERSION = 'snapback.prepared-runtime-reuse.v1';

// These files define how the build is qualified and how its receipt is
// reopened. They are outside the compiled runtime input set, but changing any
// one of them changes the meaning of a prepared-runtime hit.
export const PREPARED_RUNTIME_QUALIFICATION_INPUTS = Object.freeze([
  'packages/snapback-cli/admin-snapshot.mjs',
  'packages/snapback-cli/prepared-runtime-reuse.mjs',
  'packages/snapback-cli/runtime-readiness.mjs',
  'packages/snapback-cli/runtime-recovery.mjs',
  'scripts/bootstrap-ibex-runtime',
  'scripts/runtime-link-smoke.mjs',
]);

const BUILD_ENVIRONMENT_KEYS = new Set([
  'AR',
  'CARGO_BUILD_TARGET',
  'CARGO_ENCODED_RUSTFLAGS',
  'CARGO_INCREMENTAL',
  'CC',
  'CFLAGS',
  'CPPFLAGS',
  'CXX',
  'CXXFLAGS',
  'LDFLAGS',
  'MACOSX_DEPLOYMENT_TARGET',
  'RUSTC',
  'RUSTC_WORKSPACE_WRAPPER',
  'RUSTC_WRAPPER',
  'RUSTFLAGS',
  'SDKROOT',
  'SNAPBACK_BUILD_DISTRIBUTION',
  'SNAPBACK_BUILD_GIT_COMMIT',
  'SNAPBACK_BUILD_GIT_DIRTY',
]);

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
}

function commandOutput(command, args, environment) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: environment,
    timeout: 10_000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed while identifying the prepared runtime toolchain`);
  }
  return result.stdout.trim() || result.stderr.trim();
}

function gitOutput(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'buffer',
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed while computing the prepared runtime closure: `
        + `${result.stderr?.toString('utf8').trim() ?? ''}`,
    );
  }
  return result.stdout;
}

function runtimeInputPathspecs(root) {
  const definition = join(root, 'scripts', 'runtime-build-inputs.txt');
  const pathspecs = readFileSync(definition, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (pathspecs.length === 0) {
    throw new Error('scripts/runtime-build-inputs.txt contains no runtime input pathspecs');
  }
  return pathspecs;
}

function fileDigest(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function workingClosure(root, pathspecs, label) {
  const output = gitOutput(root, [
    'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs,
  ]);
  const paths = [...new Set(output.toString('utf8').split('\0').filter(Boolean))].sort();
  const stagedEntries = gitOutput(root, [
    'ls-files', '--stage', '-z', '--', ...pathspecs,
  ]).toString('utf8').split('\0').filter(Boolean);
  const stagedByPath = new Map(stagedEntries.map((entry) => {
    const match = entry.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.*)$/u);
    return match ? [match[3], { mode: match[1], object: match[2] }] : [entry, null];
  }));
  const entries = paths.map((path) => {
    const absolute = join(root, path);
    const staged = stagedByPath.get(path);
    if (staged?.mode === '160000') {
      let checkout = null;
      try {
        const topLevel = gitOutput(absolute, ['rev-parse', '--show-toplevel'])
          .toString('utf8').trim();
        if (realpathSync(resolve(topLevel)) === realpathSync(resolve(absolute))) {
          checkout = gitOutput(absolute, ['rev-parse', 'HEAD']).toString('utf8').trim();
        }
      } catch {}
      return { path, kind: 'gitlink', object: checkout ?? staged.object };
    }
    if (!existsSync(absolute)) return { path, kind: 'missing' };
    const metadata = lstatSync(absolute);
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(absolute);
      return { path, kind: 'symlink', bytes: Buffer.byteLength(target), sha256: digestJson(target) };
    }
    if (!metadata.isFile()) return { path, kind: 'unsupported' };
    return { path, kind: 'file', ...fileDigest(absolute) };
  });
  if (entries.length === 0) throw new Error(`${label} resolved no tracked inputs`);
  return {
    entryCount: entries.length,
    sha256: digestJson(entries),
  };
}

function relevantEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment)
    .filter(([key, value]) => (
      value !== undefined
      && (
        BUILD_ENVIRONMENT_KEYS.has(key)
        || key.startsWith('CARGO_PROFILE_')
        || (key.startsWith('CARGO_TARGET_') && key !== 'CARGO_TARGET_DIR')
        || key.startsWith('HERMES_')
        || key.startsWith('IBEX_')
        || key.startsWith('JSI_')
        || key.startsWith('OPENSSL_')
        || key.startsWith('PKG_CONFIG_')
        || key.startsWith('REACT_ANDROID_')
      )
    ))
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function readPreparedRuntimeToolchain(environment = process.env) {
  const rustcVerbose = commandOutput('rustc', ['-vV'], environment);
  return {
    cargo: commandOutput('cargo', ['--version'], environment),
    cc: commandOutput(environment.CC || 'cc', ['--version'], environment),
    cxx: commandOutput(environment.CXX || 'c++', ['--version'], environment),
    node: process.version,
    rustc: rustcVerbose,
    hostTarget: rustcVerbose.match(/^host:\s*(.+)$/mu)?.[1] ?? null,
  };
}

export function capturePreparedRuntimeReuse({
  root,
  environment = process.env,
  platform = process.platform,
  architecture = process.arch,
  toolchain = null,
} = {}) {
  root = resolve(root);
  const source = workingClosure(root, runtimeInputPathspecs(root), 'runtime source closure');
  const qualification = workingClosure(
    root,
    PREPARED_RUNTIME_QUALIFICATION_INPUTS,
    'runtime qualification closure',
  );
  const identity = {
    schemaVersion: PREPARED_RUNTIME_REUSE_SCHEMA_VERSION,
    source,
    qualification: {
      ...qualification,
      inputs: [...PREPARED_RUNTIME_QUALIFICATION_INPUTS],
      probe: 'restricted-no-eval-handler-vm',
    },
    toolchain: toolchain ?? readPreparedRuntimeToolchain(environment),
    platform: `${platform}-${architecture}`,
    buildEnvironment: relevantEnvironment(environment),
  };
  return { ...identity, closureSha256: digestJson(identity) };
}

function mismatch(reason, message, verification = null) {
  return {
    ok: false,
    reason,
    message,
    receipt: verification?.receipt ?? null,
    receiptPath: verification?.receiptPath ?? null,
    diagnostic: verification?.diagnostic ?? null,
  };
}

export function comparePreparedRuntimeReuse(recorded, current) {
  if (recorded?.schemaVersion !== PREPARED_RUNTIME_REUSE_SCHEMA_VERSION) {
    return mismatch(
      'prepared-closure-absent',
      'the readiness receipt predates the prepared-runtime closure contract',
    );
  }
  if (recorded.source?.sha256 !== current.source?.sha256
    || recorded.source?.entryCount !== current.source?.entryCount) {
    return mismatch('source-closure-drift', 'the runtime source closure changed');
  }
  if (recorded.qualification?.sha256 !== current.qualification?.sha256
    || recorded.qualification?.entryCount !== current.qualification?.entryCount
    || digestJson(recorded.qualification?.inputs) !== digestJson(current.qualification?.inputs)
    || recorded.qualification?.probe !== current.qualification?.probe) {
    return mismatch('qualification-closure-drift', 'the runtime qualification closure changed');
  }
  if (digestJson(recorded.toolchain) !== digestJson(current.toolchain)) {
    return mismatch('toolchain-drift', 'the prepared runtime toolchain changed');
  }
  if (recorded.platform !== current.platform) {
    return mismatch('platform-drift', 'the prepared runtime platform changed');
  }
  if (digestJson(recorded.buildEnvironment) !== digestJson(current.buildEnvironment)) {
    return mismatch('build-environment-drift', 'the runtime build environment changed');
  }
  const recordedWithoutDigest = { ...recorded };
  delete recordedWithoutDigest.closureSha256;
  if (recorded.closureSha256 !== digestJson(recordedWithoutDigest)) {
    return mismatch('prepared-closure-tampered', 'the recorded prepared-runtime closure digest is incoherent');
  }
  return { ok: true, reason: 'closure-identical', message: null };
}

export function verifyPreparedRuntimeReuse({
  root,
  binaryPath,
  receiptPath = null,
  environment = process.env,
  current = null,
} = {}) {
  root = resolve(root);
  binaryPath = resolve(binaryPath);
  // This is intentionally first and mandatory. It recomputes the binary and
  // current checkout's Hermes digests before closure equivalence is considered.
  const verification = verifyRuntimeReadinessReceipt({
    root,
    binaryPath,
    receiptPath,
  });
  if (!verification.ok) {
    return mismatch(
      `readiness-${verification.reason}`,
      verification.diagnostic?.message ?? 'the runtime-readiness receipt did not verify',
      verification,
    );
  }
  const receipt = verification.receipt;
  const buildIdentity = receipt.buildIdentity;
  const qualificationIdentity = receipt.qualification?.report?.binary;
  if (buildIdentity?.gitDirty !== false
    || buildIdentity?.buildProfile !== 'debug'
    || !/^[0-9a-f]{40}$/u.test(buildIdentity?.gitCommit ?? '')
    || qualificationIdentity?.gitCommit !== buildIdentity.gitCommit
    || qualificationIdentity?.gitDirty !== buildIdentity.gitDirty
    || qualificationIdentity?.buildProfile !== buildIdentity.buildProfile
    || receipt.platform !== `${process.platform}-${process.arch}`) {
    return mismatch(
      'readiness-binding-drift',
      'the readiness receipt does not bind one clean debug build identity, platform, and qualification verdict',
      verification,
    );
  }
  let captured = current;
  try {
    captured ??= capturePreparedRuntimeReuse({ root, environment });
  } catch (error) {
    return mismatch('closure-unavailable', error.message, verification);
  }
  const comparison = comparePreparedRuntimeReuse(receipt.preparedRuntime, captured);
  return comparison.ok
    ? {
        ok: true,
        reason: comparison.reason,
        message: null,
        receipt,
        receiptPath: verification.receiptPath,
        diagnostic: null,
      }
    : { ...comparison, receipt, receiptPath: verification.receiptPath };
}

function parseArgs(argv) {
  const options = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--binary') options.binaryPath = argv[++index];
    else if (argument === '--receipt') options.receiptPath = argv[++index];
    else if (argument === '--json') options.json = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (options.command !== 'verify' || !options.root || !options.binaryPath) {
    throw new Error(
      'usage: prepared-runtime-reuse.mjs verify --root <checkout> --binary <path> [--receipt <path>] [--json]',
    );
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const verdict = verifyPreparedRuntimeReuse(options);
  process.stdout.write(options.json
    ? `${JSON.stringify(verdict)}\n`
    : verdict.ok
      ? `[prepared-runtime] reusable: ${verdict.receiptPath}\n`
      : `[prepared-runtime] miss (${verdict.reason}): ${verdict.message}\n`);
  if (!verdict.ok) process.exitCode = 1;
}

if (
  process.argv[1]
  && existsSync(process.argv[1])
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
