import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const RUNTIME_RECOVERY_SCHEMA_VERSION = 'snapback.runtime-recovery.v1';

function nullableBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeStamp(stamp) {
  if (!stamp || typeof stamp !== 'object') return null;
  return {
    gitCommit: typeof stamp.gitCommit === 'string' ? stamp.gitCommit : null,
    gitDirty: nullableBoolean(stamp.gitDirty),
    crateVersion: typeof stamp.crateVersion === 'string' ? stamp.crateVersion : null,
    buildProfile: typeof stamp.buildProfile === 'string' ? stamp.buildProfile : null,
  };
}

export function createRuntimeRecoveryRecord({
  selectedBinary = null,
  selectionRung = 'none',
  expected = null,
  actualStamp = null,
  buildable = null,
  runnable = null,
  reuseAllowed = false,
  reuseReason = null,
  diagnostic = null,
  producerInputs = null,
  repairCommand = null,
  overrideCommand = null,
} = {}) {
  return {
    schemaVersion: RUNTIME_RECOVERY_SCHEMA_VERSION,
    selectedBinary: selectedBinary ? resolve(selectedBinary) : null,
    selectionRung,
    expected: normalizeStamp(expected),
    actualStamp: normalizeStamp(actualStamp),
    currentCheckout: {
      buildable: nullableBoolean(buildable),
      runnable: nullableBoolean(runnable),
    },
    reuse: {
      allowed: reuseAllowed === true,
      reason: reuseReason,
    },
    diagnostic,
    producerInputs,
    recovery: {
      repairCommand,
      overrideCommand,
    },
  };
}

export function readCheckoutRuntimeIdentity(root) {
  const git = (...args) => spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  const commitResult = git('rev-parse', 'HEAD');
  const statusResult = git('status', '--porcelain', '--untracked-files=normal');
  let crateVersion = null;
  try {
    const cargoManifest = readFileSync(join(root, 'Cargo.toml'), 'utf8');
    crateVersion = cargoManifest.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    // A source export without Cargo metadata is honestly unpinned.
  }
  return {
    gitCommit: commitResult.status === 0 ? commitResult.stdout.trim() || null : null,
    gitDirty: statusResult.status === 0 ? statusResult.stdout.trim().length > 0 : null,
    crateVersion,
    buildProfile: null,
  };
}

export function inspectRuntimeBinary(binary, environment = process.env) {
  if (!binary || !existsSync(binary)) {
    return { runnable: false, stamp: null, reason: 'selected binary does not exist' };
  }
  const cleanEnvironment = { ...environment };
  for (const key of Object.keys(cleanEnvironment)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete cleanEnvironment[key];
  }
  const result = spawnSync(binary, ['build-identity'], {
    encoding: 'utf8',
    env: cleanEnvironment,
    timeout: 15_000,
  });
  if (result.status !== 0) {
    const launch = spawnSync(binary, ['--help'], {
      encoding: 'utf8',
      env: cleanEnvironment,
      timeout: 15_000,
    });
    if (launch.status === 0) {
      return {
        runnable: true,
        stamp: null,
        reason: 'binary launches, but does not expose the build-identity command',
      };
    }
    return {
      runnable: false,
      stamp: null,
      reason: launch.error?.message
        ?? launch.stderr?.trim()
        ?? result.error?.message
        ?? result.stderr?.trim()
        ?? `binary launch exited ${launch.status ?? launch.signal ?? 'without status'}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      runnable: true,
      stamp: normalizeStamp(parsed.binary ?? parsed),
      reason: null,
    };
  } catch {
    const launch = spawnSync(binary, ['--help'], {
      encoding: 'utf8',
      env: cleanEnvironment,
      timeout: 15_000,
    });
    return {
      runnable: launch.status === 0,
      stamp: null,
      reason: launch.status === 0
        ? 'binary launches, but build-identity did not return JSON'
        : 'build-identity did not return JSON and the binary did not launch with --help',
    };
  }
}
