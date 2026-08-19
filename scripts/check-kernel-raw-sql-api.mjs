#!/usr/bin/env node

// @ref LLP 0276#phases — raw SQLite handles are kernel implementation
// details. Higher crates receive typed operations, with three audited
// read-only/connection-local seams called out below.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const KERNEL = join(ROOT, 'crates/snapback-kernel/src');
const allowed = new Set([
  'crates/snapback-kernel/src/instance_fork.rs:new',
  'crates/snapback-kernel/src/push.rs:authorize_send_in',
  'crates/snapback-kernel/src/push.rs:resolve_audience_in',
  'crates/snapback-kernel/src/replication.rs:configure_connection_wal_lifetime',
]);

function rustFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rustFiles(path);
    return entry.isFile() && entry.name.endsWith('.rs') ? [path] : [];
  });
}

const violations = [];
const observedAllowlist = new Set();
for (const path of rustFiles(KERNEL)) {
  const source = readFileSync(path, 'utf8');
  const signature = /\bpub\s+(?:async\s+)?fn\s+(\w+)[^{;]*\{/gu;
  for (const match of source.matchAll(signature)) {
    if (!/(?:&\s*(?:mut\s+)?(?:rusqlite::)?(?:Connection|Transaction)\b|\b(?:rusqlite::)?(?:Connection|Transaction)\s*[>,)])/u.test(match[0])) {
      continue;
    }
    const location = `${relative(ROOT, path)}:${match[1]}`;
    if (allowed.has(location)) {
      observedAllowlist.add(location);
      continue;
    }
    const line = source.slice(0, match.index).split('\n').length;
    violations.push(`${relative(ROOT, path)}:${line}: ${match[1]}`);
  }
}

for (const expected of allowed) {
  if (!observedAllowlist.has(expected)) {
    violations.push(`stale audited allowlist entry: ${expected}`);
  }
}

const forkSource = readFileSync(join(KERNEL, 'instance_fork.rs'), 'utf8');
if (!forkSource.includes('is_readonly(DatabaseName::Main)')) {
  violations.push('ForkReadView::new no longer verifies SQLite read-only mode');
}

if (violations.length > 0) {
  process.stderr.write(`SNAPBACK_KERNEL_RAW_SQL_API: ${violations.length} violation(s)\n`);
  for (const violation of violations) process.stderr.write(`${violation}\n`);
  process.exit(1);
}

process.stdout.write('kernel raw-SQL API gate: ok (4 audited non-commit seams)\n');
