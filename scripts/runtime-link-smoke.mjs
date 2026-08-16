#!/usr/bin/env node

// A disposable, exact Cargo link + launch proof for the current checkout.
//
// @ref LLP 0010#native-runtime-bootstrap — file presence is only a
// precondition. This probe uses this checkout's Cargo manifest, lockfile,
// build scripts, toolchain, features, native-library environment, and final
// snapback binary target, then launches that newly linked binary with ambient
// dynamic-loader overrides removed.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createRuntimeRecoveryRecord,
  IBEX_CARGO_NOT_FOUND_CODE,
  inspectRuntimeBinary,
  qualifyRuntimeBinary,
  readCheckoutRuntimeIdentity,
} from '../packages/snapback-cli/runtime-recovery.mjs';
import {
  RUNTIME_READINESS_INVALID_CODE,
  issueRuntimeReadinessReceipt,
  runtimeArtifactCandidates,
} from '../packages/snapback-cli/runtime-readiness.mjs';
import {
  capturePreparedRuntimeReuse,
  comparePreparedRuntimeReuse,
} from '../packages/snapback-cli/prepared-runtime-reuse.mjs';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
// A clean, disposable target on the serialized CI runner can legitimately
// spend more than five minutes compiling before it reaches the final link.
// Keep the probe bounded while leaving enough room for that exact build.
export const DEFAULT_RUNTIME_LINK_TIMEOUT_MS = 15 * 60_000;

function boundedAppend(current, chunk) {
  const next = current + chunk;
  return next.length <= MAX_OUTPUT_BYTES ? next : next.slice(-MAX_OUTPUT_BYTES);
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout.trim() || result.stderr.trim() || null : null;
}

function normalizeMissingSymbol(symbol) {
  const normalized = symbol.replace(/^_+(?=ex_)/, '');
  return /^[A-Za-z_][A-Za-z0-9_$.@]*$/.test(normalized) ? normalized : null;
}

export function extractMissingSymbols(output) {
  const symbols = new Set();
  const linkerFailure = /undefined symbols|undefined reference|undefined symbol|symbol\(s\) not found/i.test(output);
  const patterns = [
    /undefined reference to\s+[`'"]_?([A-Za-z_][A-Za-z0-9_$.@]*)[`'"]/gi,
    /undefined symbol:?\s+[`'"]?_?([A-Za-z_][A-Za-z0-9_$.@]*)/gi,
    /^\s*["']_?([A-Za-z_][A-Za-z0-9_$.@]*)["'],?\s*referenced from:/gim,
  ];
  if (linkerFailure) patterns.push(/\b(ex_[A-Za-z0-9_]+)\b/g);
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      const symbol = normalizeMissingSymbol(match[1]);
      if (symbol) symbols.add(symbol);
    }
  }
  return [...symbols].sort();
}

function existingInput(path) {
  try {
    const stat = statSync(path);
    return {
      path,
      bytes: stat.size,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  } catch {
    return null;
  }
}

function producerInputs(root, cargoCommand, cargoArgs, environment) {
  const rustcVerbose = commandVersion('rustc', ['-vV']);
  const hostTarget = rustcVerbose?.match(/^host:\s*(.+)$/m)?.[1] ?? null;
  const nativeEnvironment = Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) => (
        key.startsWith('HERMES_')
        || key === 'CARGO_BUILD_TARGET'
        || key === 'RUSTFLAGS'
        || key === 'CARGO_ENCODED_RUSTFLAGS'
      ))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  // One digest vocabulary: the same candidate set the persisted readiness
  // receipt records and re-verifies (LLP 0115 CV-3).
  const candidates = runtimeArtifactCandidates(root);
  return {
    root,
    manifest: join(root, 'Cargo.toml'),
    lockfile: join(root, 'Cargo.lock'),
    target: 'snapback',
    profile: 'debug',
    featureSelection: {
      defaultFeatures: true,
      explicitlyEnabled: [],
    },
    cargoCommand,
    cargoArgs: cargoArgs.map((arg) => arg.includes('snapback-runtime-link-')
      ? '<temporary-target-dir>'
      : arg),
    cargoVersion: commandVersion(cargoCommand, ['--version']),
    rustcVersion: commandVersion('rustc', ['--version']),
    hostTarget,
    platform: `${process.platform}-${process.arch}`,
    nativeEnvironment,
    cargoInputs: [
      join(root, 'Cargo.toml'),
      join(root, 'Cargo.lock'),
      join(root, 'build.rs'),
      join(root, '.cargo/config.toml'),
      join(root, 'vendor/ibex/Cargo.toml'),
      join(root, 'vendor/ibex/build.rs'),
    ].map(existingInput).filter(Boolean),
    nativeArtifacts: candidates.map(existingInput).filter(Boolean),
  };
}

function runChild(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let interruptedSignal = null;
    let spawnError = null;
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => { stdout = boundedAppend(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = boundedAppend(stderr, chunk.toString()); });
    child.once('error', (error) => { spawnError = error; });
    const terminate = (signal) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // The child already exited.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      setTimeout(() => terminate('SIGKILL'), 2_000).unref();
    }, timeoutMs);
    const forwarded = new Map();
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const listener = () => {
        interruptedSignal = signal;
        terminate(signal);
      };
      forwarded.set(signal, listener);
      process.once(signal, listener);
    }
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      for (const [forwardedSignal, listener] of forwarded) {
        process.removeListener(forwardedSignal, listener);
      }
      resolveResult({
        status,
        signal,
        stdout,
        stderr,
        timedOut,
        interruptedSignal,
        spawnError,
      });
    });
  });
}

function staleBinaryCandidate(root, environment) {
  const configured = environment.SNAPBACK_SERVER_BINARY;
  if (configured && existsSync(resolve(root, configured))) {
    return { binary: resolve(root, configured), rung: 'configured' };
  }
  const prebuilt = join(root, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  return existsSync(prebuilt) ? { binary: prebuilt, rung: 'prebuilt' } : null;
}

export function stageLinuxLoaderClosure(
  root,
  targetDir,
  { platform = process.platform } = {},
) {
  if (platform !== 'linux') return null;
  const source = join(root, 'vendor/ibex/linux/lib/libhermesvm.so');
  if (!existsSync(source)) return null;
  const directory = join(targetDir, 'lib');
  const destination = join(directory, 'libhermesvm.so');
  mkdirSync(directory, { recursive: true });
  copyFileSync(source, destination);
  return destination;
}

export async function runRuntimeLinkProbe({
  root = DEFAULT_ROOT,
  cargoCommand = 'cargo',
  environment = process.env,
  timeoutMs = DEFAULT_RUNTIME_LINK_TIMEOUT_MS,
  targetDirectory = null,
  keepTarget = false,
} = {}) {
  root = resolve(root);
  const ownsTargetDirectory = targetDirectory === null;
  if (!ownsTargetDirectory && !keepTarget) {
    const error = new Error(
      'a caller-supplied --target-dir is not owned by the runtime-link probe; pass --keep-target so it cannot be recursively deleted',
    );
    error.code = 'SNAPBACK_IBEX_RUNTIME_LINK_TARGET_NOT_OWNED';
    throw error;
  }
  const targetDir = targetDirectory
    ? resolve(targetDirectory)
    : mkdtempSync(join(tmpdir(), 'snapback-runtime-link-'));
  const binary = join(targetDir, 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  const cargoArgs = ['build', '--locked', '--bin', 'snapback', '--target-dir', targetDir];
  const expected = readCheckoutRuntimeIdentity(root);
  const inputs = producerInputs(root, cargoCommand, cargoArgs, environment);
  let preparedRuntimeBefore = null;
  try {
    preparedRuntimeBefore = capturePreparedRuntimeReuse({ root, environment });
  } catch (error) {
    // Source exports and narrow link-probe fixtures may not carry the
    // repository's prepared-runtime closure authorities. They can still
    // receive an ordinary readiness receipt after qualification.
    console.error(
      `[runtime-link-smoke] prepared-runtime closure capture before build failed: `
        + `${error?.message ?? error}; continuing with ordinary readiness qualification`,
    );
  }
  const candidate = staleBinaryCandidate(root, environment);
  let result;
  try {
    result = await runChild(cargoCommand, cargoArgs, {
      cwd: root,
      env: environment,
      timeoutMs,
    });
    const combined = `${result.stdout}\n${result.stderr}`;
    if (result.status !== 0) {
      const missingSymbols = extractMissingSymbols(combined);
      const cargoNotFound = result.spawnError?.code === 'ENOENT'
        && result.spawnError?.path === cargoCommand;
      let code = 'SNAPBACK_IBEX_CARGO_BUILD_FAILED';
      if (cargoNotFound) code = IBEX_CARGO_NOT_FOUND_CODE;
      else if (result.spawnError) code = 'SNAPBACK_IBEX_RUNTIME_LINK_PROBE_FAILED';
      else if (result.interruptedSignal) code = 'SNAPBACK_IBEX_RUNTIME_LINK_INTERRUPTED';
      else if (missingSymbols.length > 0) code = 'SNAPBACK_IBEX_RUNTIME_LINK_FAILED';
      else if (result.timedOut) code = 'SNAPBACK_IBEX_RUNTIME_LINK_TIMEOUT';
      const inspected = candidate
        ? inspectRuntimeBinary(candidate.binary, environment)
        : { runnable: false, stamp: null, reason: 'no prior binary exists' };
      const diagnostic = {
        code,
        severity: 'error',
        subsystem: 'runtime-link',
        message: cargoNotFound
          ? `the exact-link probe could not find the Cargo command ${JSON.stringify(cargoCommand)}. `
            + 'Install the Rust toolchain, or put ~/.cargo/bin on PATH.'
          : result.spawnError
          ? `the exact-link probe could not launch Cargo: ${result.spawnError.message}`
          : result.interruptedSignal
            ? `the exact-link probe was interrupted by ${result.interruptedSignal}`
            : missingSymbols.length > 0
              ? `the current checkout cannot link; missing symbols: ${missingSymbols.join(', ')}`
              : result.timedOut
                ? `the current checkout link probe exceeded ${timeoutMs}ms`
                : 'the current checkout did not compile and link its snapback binary',
        details: {
          missingSymbols,
          status: result.status,
          signal: result.signal,
          stderr: result.stderr.slice(-16_000),
          spawnError: result.spawnError
            ? {
                code: result.spawnError.code ?? null,
                message: result.spawnError.message,
                path: result.spawnError.path ?? null,
                syscall: result.spawnError.syscall ?? null,
              }
            : null,
          producerInputs: inputs,
        },
      };
      return {
        ok: false,
        diagnostic,
        recovery: createRuntimeRecoveryRecord({
          selectedBinary: candidate?.binary ?? null,
          selectionRung: candidate?.rung ?? 'none',
          expected,
          actualStamp: inspected.stamp,
          buildable: false,
          runnable: inspected.runnable,
          reuseAllowed: false,
          reuseReason: candidate
            ? `automatic reuse refused: current checkout link failed; prior binary ${inspected.reason ?? 'is runnable but requires explicit selection'}`
            : 'automatic reuse refused: current checkout link failed and no prior binary exists',
          diagnostic: { code, missingSymbols },
          producerInputs: inputs,
          repairCommand: `${join(root, 'scripts/bootstrap-ibex-runtime')}`,
          overrideCommand: inspected.runnable
            ? `SNAPBACK_SERVER_BINARY=${JSON.stringify(candidate.binary)}`
            : null,
        }),
      };
    }
    // @ref LLP 0010#native-runtime-bootstrap — Linux binaries deliberately
    // carry only the public package's loader-relative RUNPATH. Reproduce that
    // exact bin/../lib closure for the disposable target instead of relying
    // on LD_LIBRARY_PATH or embedding a checkout-absolute path.
    stageLinuxLoaderClosure(root, targetDir);
    const inspected = inspectRuntimeBinary(binary, environment);
    if (!inspected.runnable) {
      const code = 'SNAPBACK_IBEX_RUNTIME_LOAD_FAILED';
      const diagnostic = {
        code,
        severity: 'error',
        subsystem: 'runtime-link',
        message: 'the newly linked snapback binary did not launch with dynamic-loader overrides scrubbed',
        details: { reason: inspected.reason, producerInputs: inputs },
      };
      return {
        ok: false,
        diagnostic,
        recovery: createRuntimeRecoveryRecord({
          selectedBinary: binary,
          selectionRung: 'exact-link-probe',
          expected,
          actualStamp: inspected.stamp,
          buildable: true,
          runnable: false,
          reuseAllowed: false,
          reuseReason: inspected.reason,
          diagnostic: { code, missingSymbols: [] },
          producerInputs: inputs,
          repairCommand: `${join(root, 'scripts/bootstrap-ibex-runtime')}`,
        }),
      };
    }
    // Launch alone proved dynamic loading, not runtime readiness: every JS
    // handler can still refuse at `RuntimeGuard::create` when the selected
    // Hermes framework and the linked glue disagree on the restricted
    // no-eval VM's behavior contract. Certify handler-VM creation against
    // the exact binary this probe just linked; the recovery record carries
    // the framework digests (producerInputs.nativeArtifacts) and the
    // binary's build identity so artifact/link incoherence is diagnosable.
    const qualification = qualifyRuntimeBinary(binary, environment);
    const qualificationRecord = {
      probe: 'restricted-no-eval-handler-vm',
      ok: qualification.ok,
      reason: qualification.reason,
      report: qualification.report,
    };
    if (!qualification.ok) {
      const code = 'SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED';
      const diagnostic = {
        code,
        severity: 'error',
        subsystem: 'runtime-link',
        message: `the newly linked snapback binary launched but could not create its restricted no-eval handler VM: ${qualification.reason}`,
        details: {
          qualification: qualificationRecord,
          stderr: qualification.stderr,
          producerInputs: inputs,
        },
      };
      return {
        ok: false,
        diagnostic,
        recovery: createRuntimeRecoveryRecord({
          selectedBinary: binary,
          selectionRung: 'exact-link-probe',
          expected,
          actualStamp: inspected.stamp,
          buildable: true,
          runnable: true,
          qualification: qualificationRecord,
          reuseAllowed: false,
          reuseReason: 'the linked binary cannot create the armed handler VM; refresh Hermes artifacts and relink before serving JS handlers',
          diagnostic: { code, missingSymbols: [] },
          producerInputs: inputs,
          repairCommand: `${join(root, 'scripts/bootstrap-ibex-runtime')}`,
        }),
      };
    }
    // A kept target is a binary that will be SERVED (bootstrap's
    // `--target-dir target --keep-target`, the kit's cargo rung), so persist
    // the qualification as the CV-3 readiness receipt beside it. The
    // disposable path (doctor) stays read-only and persists nothing.
    let receiptPath = null;
    if (keepTarget) {
      try {
        let preparedRuntime = null;
        if (preparedRuntimeBefore !== null) {
          try {
            const preparedRuntimeAfter = capturePreparedRuntimeReuse({ root, environment });
            // @ref LLP 0232#d-2-prepared-execution-and-rebase-stable-records — bind reusable preparation only when the
            // source/toolchain/qualification closure stayed unchanged across
            // the actual build and qualification window. Otherwise the
            // ordinary readiness proof remains valid, but it cannot transfer
            // prepared work to another checkout.
            if (comparePreparedRuntimeReuse(
              preparedRuntimeBefore,
              preparedRuntimeAfter,
            ).ok) {
              preparedRuntime = preparedRuntimeAfter;
            }
          } catch (error) {
            // The ordinary receipt remains useful even when the optional
            // prepared-runtime closure cannot be recaptured after the build.
            console.error(
              `[runtime-link-smoke] prepared-runtime closure capture after qualification failed: `
                + `${error?.message ?? error}; issuing an ordinary non-reusable readiness receipt`,
            );
          }
        }
        ({ receiptPath } = issueRuntimeReadinessReceipt({
          root,
          binaryPath: binary,
          qualification: qualificationRecord,
          issuer: 'runtime-link-smoke',
          preparedRuntime,
        }));
      } catch (error) {
        const code = RUNTIME_READINESS_INVALID_CODE;
        const diagnostic = {
          code,
          severity: 'error',
          subsystem: 'runtime-readiness',
          message: `the binary qualified but its readiness receipt could not be persisted: ${error.message}`,
          details: { qualification: qualificationRecord, producerInputs: inputs },
        };
        return {
          ok: false,
          diagnostic,
          recovery: createRuntimeRecoveryRecord({
            selectedBinary: binary,
            selectionRung: 'exact-link-probe',
            expected,
            actualStamp: inspected.stamp,
            buildable: true,
            runnable: true,
            qualification: qualificationRecord,
            reuseAllowed: false,
            reuseReason: 'qualification passed but no persisted readiness receipt exists; downstream consumers would refuse this runtime',
            diagnostic: { code, missingSymbols: [] },
            producerInputs: inputs,
            repairCommand: `${join(root, 'scripts/bootstrap-ibex-runtime')}`,
          }),
        };
      }
    }
    return {
      ok: true,
      diagnostic: {
        code: 'SNAPBACK_IBEX_RUNTIME_LINK_OK',
        severity: 'info',
        subsystem: 'runtime-link',
        message: 'the current checkout linked, launched, and handler-VM-qualified an exact disposable snapback binary',
        details: { qualification: qualificationRecord, receiptPath, producerInputs: inputs },
      },
      recovery: createRuntimeRecoveryRecord({
        selectedBinary: keepTarget ? binary : null,
        selectionRung: 'exact-link-probe',
        expected,
        actualStamp: inspected.stamp,
        buildable: true,
        runnable: true,
        qualification: qualificationRecord,
        reuseAllowed: true,
        reuseReason: 'newly linked current-checkout binary launched and created its restricted no-eval handler VM',
        diagnostic: { code: 'SNAPBACK_IBEX_RUNTIME_LINK_OK', missingSymbols: [] },
        producerInputs: inputs,
      }),
    };
  } finally {
    if (ownsTargetDirectory) rmSync(targetDir, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--keep-target') options.keepTarget = true;
    else if (arg === '--target-dir') options.targetDirectory = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.keepTarget && !options.targetDirectory) {
    throw new Error('--keep-target requires --target-dir');
  }
  if (options.targetDirectory && !options.keepTarget) {
    throw new Error('--target-dir requires --keep-target because the probe does not own caller paths');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runRuntimeLinkProbe(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`[runtime-link-smoke] ${result.diagnostic.code}: ${result.diagnostic.message}\n`);
    process.stdout.write(`[runtime-link-smoke] recovery ${JSON.stringify(result.recovery)}\n`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (
  process.argv[1]
  && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
