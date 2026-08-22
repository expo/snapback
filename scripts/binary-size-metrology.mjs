#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { arch as hostArchitecture, platform as hostPlatform } from 'node:process';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyRuntimeReadinessReceipt } from '../packages/snapback-cli/runtime-readiness.mjs';
import { readCheckoutRuntimeIdentity } from '../packages/snapback-cli/runtime-recovery.mjs';

// @ref LLP 0010#debug-binary-size-metrology — debug builds retain full split
// debug information, so bootstrap reports size drift without blocking readiness.

export const BINARY_SIZE_DRIFT = 'BINARY_SIZE_DRIFT';
export const DEFAULT_TOLERANCE = 0.15;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKTREE_ROOT = resolve(SCRIPT_DIR, '..');
export const DEFAULT_BASELINE = resolve(SCRIPT_DIR, 'binary-size-baseline.json');

const TRACKED_METRICS = ['bytes', '__LINKEDIT', 'strsize'];
const HASH_CHUNK_BYTES = 1024 * 1024;

function parseInteger(value, label) {
  if (!/^(?:0x[0-9a-f]+|[0-9]+)$/iu.test(value ?? '')) {
    throw new Error(`otool reported an invalid ${label}: ${value ?? '<missing>'}`);
  }
  const parsed = Number.parseInt(value, value.toLowerCase().startsWith('0x') ? 16 : 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`otool reported an out-of-range ${label}: ${value}`);
  }
  return parsed;
}

function field(block, name) {
  return block.match(new RegExp(`^\\s*${name}\\s+(\\S+)\\s*$`, 'mu'))?.[1] ?? null;
}

export function parseOtoolOutput(output) {
  const metrics = {};
  const loadCommands = output.split(/(?=^Load command [0-9]+\s*$)/mu);

  for (const command of loadCommands) {
    if (/^\s*cmd LC_SEGMENT(?:_64)?\s*$/mu.test(command)) {
      const header = command.split(/^Section\s*$/mu, 1)[0];
      const segment = field(header, 'segname');
      const virtualSize = field(header, 'vmsize');
      if (segment && virtualSize && ['__TEXT', '__DATA', '__DATA_CONST', '__LINKEDIT'].includes(segment)) {
        metrics[segment] = parseInteger(virtualSize, `${segment} vmsize`);
      }

      for (const section of command.split(/^Section\s*$/mu).slice(1)) {
        if (field(section, 'sectname') === '__eh_frame') {
          metrics.__eh_frame = parseInteger(field(section, 'size'), '__eh_frame size');
        }
      }
    } else if (/^\s*cmd LC_SYMTAB\s*$/mu.test(command)) {
      metrics.nsyms = parseInteger(field(command, 'nsyms'), 'LC_SYMTAB nsyms');
      metrics.strsize = parseInteger(field(command, 'strsize'), 'LC_SYMTAB strsize');
    }
  }

  for (const required of ['__TEXT', '__LINKEDIT', 'nsyms', 'strsize']) {
    if (!Number.isSafeInteger(metrics[required])) {
      throw new Error(`otool output did not contain ${required}`);
    }
  }
  return metrics;
}

export const parseOtoolLoadCommands = parseOtoolOutput;

function defaultOtool(binary) {
  const result = spawnSync('otool', ['-l', binary], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error?.code === 'ENOENT') return { unsupported: true, reason: 'otool is not installed' };
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`otool -l failed for ${binary}: ${(result.stderr || `exit ${result.status}`).trim()}`);
  }
  return { output: result.stdout };
}

export function measureBinary(binary, {
  platform = hostPlatform,
  runOtool = defaultOtool,
} = {}) {
  if (platform !== 'darwin') {
    return { unsupported: true, reason: `Mach-O size metrology is unsupported on ${platform}` };
  }

  const otool = runOtool(binary);
  if (otool.unsupported) return otool;
  return {
    bytes: statSync(binary).size,
    ...parseOtoolOutput(otool.output),
  };
}

export function compareMetrics(metrics, baselineMetrics, tolerance = DEFAULT_TOLERANCE) {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`tolerance must be a non-negative number, got ${tolerance}`);
  }

  return TRACKED_METRICS.map((name) => {
    const current = metrics?.[name];
    const baseline = baselineMetrics?.[name];
    if (!Number.isSafeInteger(current) || current < 0) {
      throw new Error(`measurement is missing non-negative integer metric ${name}`);
    }
    if (!Number.isSafeInteger(baseline) || baseline < 0) {
      throw new Error(`baseline is missing non-negative integer metric ${name}`);
    }
    const growth = baseline === 0
      ? (current === 0 ? 0 : Number.POSITIVE_INFINITY)
      : (current - baseline) / baseline;
    return {
      name,
      current,
      baseline,
      growth,
      failed: growth > tolerance,
    };
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || `exit ${result.status}`).trim()}`);
  }
  return result.stdout.trim();
}

export function digestBinary(binary) {
  let descriptor;
  try {
    descriptor = openSync(binary, 'r');
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`selected binary is not a regular file: ${binary}`);
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, Math.max(metadata.size, 1)));
    let consumed = 0;
    while (consumed < metadata.size) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, metadata.size - consumed),
        null,
      );
      if (count === 0) break;
      hash.update(chunk.subarray(0, count));
      consumed += count;
    }
    if (consumed !== metadata.size) {
      throw new Error(`selected binary changed or became unreadable while hashing: ${binary}`);
    }
    return { bytes: metadata.size, sha256: hash.digest('hex') };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validatedBinaryDigest(binary, digestBinaryFn) {
  const digest = digestBinaryFn(binary);
  if (
    !Number.isSafeInteger(digest?.bytes)
    || digest.bytes < 0
    || !/^[0-9a-f]{64}$/u.test(digest?.sha256 ?? '')
  ) {
    throw new Error(`binary digest function returned an invalid result for ${binary}`);
  }
  return digest;
}

function assertBinaryUnchanged(binary, before, after) {
  if (before.bytes !== after.bytes || before.sha256 !== after.sha256) {
    throw new Error(`binary changed during measurement: ${binary}`);
  }
}

function isWithin(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../'));
}

function runtimeRootForBinary(binary, worktreeRoot) {
  const targetRoot = resolve(worktreeRoot, 'target');
  if (isWithin(targetRoot, binary)) return resolve(worktreeRoot);

  let ancestor = dirname(resolve(binary));
  while (dirname(ancestor) !== ancestor) {
    if (basename(ancestor) === 'target') return dirname(ancestor);
    ancestor = dirname(ancestor);
  }
  return resolve(worktreeRoot);
}

export function baselineRecord(binary, metrics, {
  architecture = hostArchitecture,
  digestBinaryFn = digestBinary,
  initialBinaryDigest = null,
  now = () => new Date(),
  readCheckoutRuntimeIdentityFn = readCheckoutRuntimeIdentity,
  runCommand = run,
  verifyReceiptFn = verifyRuntimeReadinessReceipt,
  worktreeRoot = WORKTREE_ROOT,
} = {}) {
  binary = resolve(binary);
  worktreeRoot = resolve(worktreeRoot);
  const receiptPath = `${binary}.runtime-readiness.json`;
  const binaryDigest = initialBinaryDigest === null
    ? validatedBinaryDigest(binary, digestBinaryFn)
    : validatedBinaryDigest(binary, () => initialBinaryDigest);
  if (metrics?.bytes !== binaryDigest.bytes) {
    throw new Error(
      `measured binary size ${metrics?.bytes ?? '<missing>'} does not match the hashed binary size ${binaryDigest.bytes}: ${binary}`,
    );
  }

  let receipt = null;
  let commit;
  let gitDirty;
  let provenanceSource;
  if (existsSync(receiptPath)) {
    const verdict = verifyReceiptFn({
      root: runtimeRootForBinary(binary, worktreeRoot),
      binaryPath: binary,
      receiptPath,
    });
    if (!verdict?.ok) {
      const reason = verdict?.reason ?? 'invalid';
      const message = verdict?.diagnostic?.message ?? 'the shared verifier rejected it';
      throw new Error(`runtime readiness receipt is ${reason}: ${message}`);
    }
    receipt = verdict.receipt;
    if (
      receipt.binary.bytes !== binaryDigest.bytes
      || receipt.binary.sha256 !== binaryDigest.sha256
    ) {
      throw new Error(
        `runtime readiness receipt binary digest does not match the measured binary: ${receiptPath}`,
      );
    }
    const receiptIdentity = receipt.buildIdentity;
    const qualificationIdentity = receipt.qualification?.report?.binary;
    if (
      !/^[0-9a-f]{40}$/u.test(receiptIdentity?.gitCommit ?? '')
      || typeof receiptIdentity?.gitDirty !== 'boolean'
    ) {
      throw new Error(
        `runtime readiness receipt does not carry a valid buildIdentity gitCommit/gitDirty pair: ${receiptPath}`,
      );
    }
    if (
      !/^[0-9a-f]{40}$/u.test(qualificationIdentity?.gitCommit ?? '')
      || typeof qualificationIdentity?.gitDirty !== 'boolean'
      || qualificationIdentity.gitCommit !== receiptIdentity.gitCommit
      || qualificationIdentity.gitDirty !== receiptIdentity.gitDirty
    ) {
      throw new Error(
        `runtime readiness receipt buildIdentity does not match its qualification binary identity: ${receiptPath}`,
      );
    }
    commit = receiptIdentity.gitCommit;
    gitDirty = receiptIdentity.gitDirty;
    provenanceSource = 'readiness-receipt';
  } else {
    // Custody is decided on canonical paths: measurement and hashing follow
    // symlinks, so a symlinked target/ entry pointing at another checkout's
    // binary must not be attributed to this worktree's commit/dirty state.
    const targetRoot = resolve(worktreeRoot, 'target');
    const canonicalTarget = existsSync(targetRoot) ? realpathSync(targetRoot) : targetRoot;
    const canonicalBinary = realpathSync(binary);
    if (!isWithin(targetRoot, binary) || !isWithin(canonicalTarget, canonicalBinary)) {
      throw new Error(
        `no runtime readiness receipt exists for binary outside the current worktree target: ${binary}`,
      );
    }
    const checkoutIdentity = readCheckoutRuntimeIdentityFn(worktreeRoot);
    if (
      !/^[0-9a-f]{40}$/u.test(checkoutIdentity?.gitCommit ?? '')
      || typeof checkoutIdentity?.gitDirty !== 'boolean'
    ) {
      throw new Error(`could not read the current checkout runtime identity: ${worktreeRoot}`);
    }
    commit = checkoutIdentity.gitCommit;
    gitDirty = checkoutIdentity.gitDirty;
    provenanceSource = 'git-fallback';
  }
  const rustc = runCommand('rustc', ['-V']);
  const verboseRustc = runCommand('rustc', ['-vV']);
  const targetTriple = receipt?.preparedRuntime?.toolchain?.hostTarget
    ?? verboseRustc.match(/^host:\s*(\S+)\s*$/mu)?.[1];
  if (!targetTriple) throw new Error('rustc -vV did not report a host target triple');
  assertBinaryUnchanged(binary, binaryDigest, validatedBinaryDigest(binary, digestBinaryFn));

  return {
    commit,
    gitDirty,
    provenanceSource,
    sha256: binaryDigest.sha256,
    rustc,
    targetTriple,
    hostArch: architecture,
    measuredAt: now().toISOString(),
    metrics,
  };
}

function formatInteger(value) {
  return value.toLocaleString('en-US');
}

function formatGrowth(growth) {
  if (!Number.isFinite(growth)) return '+Infinity%';
  return `${growth >= 0 ? '+' : ''}${(growth * 100).toFixed(2)}%`;
}

export function formatComparison(comparison) {
  return `${comparison.name} ${formatInteger(comparison.current)} vs baseline ${formatInteger(comparison.baseline)} (${formatGrowth(comparison.growth)})`;
}

function parseCli(argv) {
  const [command, binary, ...rest] = argv;
  if (!['measure', 'check'].includes(command) || !binary) {
    throw new Error('usage: binary-size-metrology.mjs <measure|check> <binary> [--baseline <path>] [--tolerance <fraction>] [--write-baseline]');
  }
  const options = {
    command,
    binary: resolve(binary),
    baseline: DEFAULT_BASELINE,
    tolerance: DEFAULT_TOLERANCE,
    writeBaseline: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--baseline') {
      if (!rest[index + 1]) throw new Error('--baseline requires a path');
      options.baseline = resolve(rest[++index]);
    } else if (argument === '--tolerance') {
      if (!rest[index + 1]) throw new Error('--tolerance requires a number');
      options.tolerance = Number(rest[++index]);
    } else if (argument === '--write-baseline') {
      options.writeBaseline = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (command === 'measure' && options.writeBaseline) {
    throw new Error('--write-baseline is valid only with check');
  }
  return options;
}

export function runCli(argv, {
  measureBinaryFn = measureBinary,
  baselineRecordFn = baselineRecord,
  digestBinaryFn = digestBinary,
  readBaselineFn = (path) => JSON.parse(readFileSync(path, 'utf8')),
  writeBaselineFn = (path, record) => writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let binary = null;
  let initialBinaryDigest = null;
  let coherenceChecked = false;
  try {
    const options = parseCli(argv);
    binary = options.binary;
    if (measureBinaryFn === measureBinary && hostPlatform !== 'darwin') {
      const metrics = measureBinaryFn(options.binary);
      if (options.command === 'measure') {
        stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
      } else {
        stdout.write(`binary size check skipped: ${metrics.reason}\n`);
      }
      return 0;
    }

    initialBinaryDigest = validatedBinaryDigest(options.binary, digestBinaryFn);
    const metrics = measureBinaryFn(options.binary);
    if (metrics.unsupported) {
      assertBinaryUnchanged(
        options.binary,
        initialBinaryDigest,
        validatedBinaryDigest(options.binary, digestBinaryFn),
      );
      coherenceChecked = true;
      if (options.command === 'measure') {
        stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
      } else {
        stdout.write(`binary size check skipped: ${metrics.reason}\n`);
      }
      return 0;
    }

    if (options.command === 'measure') {
      assertBinaryUnchanged(
        options.binary,
        initialBinaryDigest,
        validatedBinaryDigest(options.binary, digestBinaryFn),
      );
      coherenceChecked = true;
      stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
      return 0;
    }

    let replacementBaseline = null;
    if (options.writeBaseline) {
      replacementBaseline = baselineRecordFn(options.binary, metrics, { initialBinaryDigest });
    }
    const baseline = replacementBaseline ?? readBaselineFn(options.baseline);
    const comparisons = compareMetrics(metrics, baseline.metrics, options.tolerance);
    assertBinaryUnchanged(
      options.binary,
      initialBinaryDigest,
      validatedBinaryDigest(options.binary, digestBinaryFn),
    );
    coherenceChecked = true;
    if (replacementBaseline !== null) writeBaselineFn(options.baseline, replacementBaseline);
    for (const comparison of comparisons) stdout.write(`${formatComparison(comparison)}\n`);
    const failures = comparisons.filter((comparison) => comparison.failed);
    if (failures.length > 0) {
      stderr.write(`${BINARY_SIZE_DRIFT}: ${failures.map(({ name }) => name).join(', ')} grew past the ${(options.tolerance * 100).toFixed(2)}% tolerance\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    if (initialBinaryDigest !== null && !coherenceChecked) {
      try {
        assertBinaryUnchanged(
          binary,
          initialBinaryDigest,
          validatedBinaryDigest(binary, digestBinaryFn),
        );
      } catch (coherenceError) {
        if (/binary changed during measurement/u.test(coherenceError.message)) error = coherenceError;
      }
    }
    stderr.write(`binary-size-metrology: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
