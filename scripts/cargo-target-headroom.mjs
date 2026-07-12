#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — resource guards measure the filesystem
// Cargo actually uses, including config- or environment-selected targets.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_CARGO_TARGET_HEADROOM_KIB = 8 * 1024 * 1024;

function completed(result, command) {
  if (result.error) throw new Error(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${String(result.stderr ?? '').trim()}`);
  }
  return String(result.stdout ?? '');
}

export function resolveCargoTargetDirectory({ root = ROOT, spawnSyncImpl = spawnSync } = {}) {
  const output = completed(
    spawnSyncImpl('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
      cwd: root,
      encoding: 'utf8',
    }),
    'cargo metadata',
  );
  const target = JSON.parse(output).target_directory;
  if (typeof target !== 'string' || target.length === 0) {
    throw new Error('cargo metadata did not return target_directory');
  }
  return target;
}

export function measureAvailableKiB(targetDirectory, { spawnSyncImpl = spawnSync } = {}) {
  const output = completed(
    spawnSyncImpl('df', ['-Pk', targetDirectory], { encoding: 'utf8' }),
    'df',
  );
  const rows = output.trim().split(/\r?\n/);
  if (rows.length < 2) throw new Error('df returned no filesystem row');
  const columns = rows.at(-1).trim().split(/\s+/);
  const available = columns[3];
  if (!/^\d+$/.test(available ?? '')) throw new Error(`df returned invalid available KiB: ${available}`);
  return Number(available);
}

export function cargoTargetHeadroom(options = {}) {
  const targetDirectory = resolveCargoTargetDirectory(options);
  const availableKiB = measureAvailableKiB(targetDirectory, options);
  return {
    targetDirectory,
    availableKiB,
    cleanup: availableKiB < MIN_CARGO_TARGET_HEADROOM_KIB ? 'clean' : 'preserve',
  };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const result = cargoTargetHeadroom();
    process.stderr.write(
      `[cargo-headroom] target directory: ${result.targetDirectory}; available: ${result.availableKiB} KiB\n`,
    );
    process.stdout.write(process.argv.includes('--cleanup-decision')
      ? `${result.cleanup}\n`
      : `${result.availableKiB}\n`);
  } catch (error) {
    process.stderr.write(`[cargo-headroom] error: ${error.message}\n`);
    process.exit(1);
  }
}
