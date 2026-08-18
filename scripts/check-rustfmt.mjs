#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0010#ci-and-review-gates — canonical proof gates are stable,
// non-vacuous, and fail closed when their checked authority cannot run.
// @ref LLP 0175#d22-affected-proof — Rust changes select this cheap formatting
// check through the checked local-proof policy.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIAGNOSTIC = 'SNAPBACK_RUSTFMT_CHECK_FAILED';

function fail(message) {
  process.stderr.write(`${DIAGNOSTIC}: ${message}\n`);
  process.exitCode = 1;
}

function main() {
  if (!existsSync(join(ROOT, 'Cargo.toml'))) {
    fail('root Cargo.toml is missing; refusing a vacuous formatting pass');
    return;
  }

  const rustSources = globSync([
    'crates/*/src/**/*.rs',
    'crates/*/tests/**/*.rs',
    'crates/*/examples/**/*.rs',
    'crates/*/build.rs',
  ], { cwd: ROOT });
  if (rustSources.length === 0) {
    fail('no Rust source files were found; refusing a vacuous formatting pass');
    return;
  }

  const result = spawnSync('cargo', ['fmt', '--all', '--', '--check'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (result.error) {
    fail(`cargo fmt could not start: ${result.error.message}`);
    return;
  }
  if (result.signal) {
    fail(`cargo fmt terminated by signal ${result.signal}`);
    return;
  }
  if (result.status !== 0) {
    fail(`cargo fmt --all -- --check exited ${result.status}`);
    return;
  }

  process.stdout.write(`[rustfmt] PASS: ${rustSources.length} Rust source files checked\n`);
}

main();
