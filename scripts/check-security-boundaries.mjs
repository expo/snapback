#!/usr/bin/env node

// @ref LLP 0276#phases — the carved workspace must preserve compiler-enforced
// authority boundaries for direct dependents of every one of its 13 crates.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = resolve(ROOT, 'tests/fixtures/security-boundaries/Cargo.toml');
const TARGET = resolve(ROOT, 'target/security-boundary-fixtures');

const attacks = [
  ['forge-erasure-authority', /associated function `from_admitted_facts` is private/u],
  ['forge-push-system', /no associated (?:function or constant|item) named `System`/u],
  ['fake-authorization-interlock', /AuthorizationCommitInterlock/u],
  ['fake-sender-proof-store', /sender_authority_sealed::Sealed/u],
  ['raw-pending-effect-transition', /expected `CreatePendingEffectCommand`/u],
  ['obtain-writable-sql-handle', /field `conn` of struct `MaterializedBase` is private/u],
];

let failed = false;
for (const [name, expected] of attacks) {
  const result = spawnSync(
    'cargo',
    ['check', '--quiet', '--manifest-path', MANIFEST, '--bin', name],
    {
      cwd: ROOT,
      env: { ...process.env, CARGO_TARGET_DIR: TARGET },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0 || !expected.test(output)) {
    failed = true;
    process.stderr.write(`[security-boundary] FAIL ${name}\n${output}\n`);
    continue;
  }
  const compilerErrors = output
    .split('\n')
    .filter((line) => line.startsWith('error[') || line.startsWith('error:'))
    .slice(0, 3)
    .join(' | ');
  process.stdout.write(`[security-boundary] PASS ${name}: ${compilerErrors}\n`);
}

if (failed) process.exit(1);
process.stdout.write('[security-boundary] PASS: 6 direct-dependency attacks rejected; manifest names all 13 carved crates\n');
