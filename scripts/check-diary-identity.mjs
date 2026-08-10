#!/usr/bin/env node
// issues/closed/20260808-diary-number-identity-collisions: identity policy
// and collision guard for diary numeric identities.
//
// AGENTS.md says demo diaries use `NNNN-slug.diary.md` with "the next
// available number", but many concurrent agent sessions push to `main`
// around the clock, so two sessions can both observe the same next number
// before either lands. The corpus already carries historical collisions
// (0022, 0042-0048, 0054, 0058, 0065). "Diary NNNN" is used as a shorthand
// reference in LLPs and issues, so a duplicated prefix makes that reference
// ambiguous.
//
// Alias policy (author ruling, 2026-08-10): KNOWN_COLLISIONS is the canonical
// disposition for the 11 historical duplicate numbers. Existing filenames
// and citations stay untouched. Bare "Diary NNNN" references are authoritative
// only for non-colliding numbers; every known colliding number must be
// qualified with its slug. A new collision is never an alias automatically.
//
// What this checks: every `*.md` file directly under `diaries/` is parsed
// for the four-digit numeric prefix. Any prefix used by more than one file
// is reported, grouped by prefix. Collisions are split into:
//   - KNOWN: exactly the file set recorded in KNOWN_COLLISIONS below
//     (historical, preserved because prose/receipts may cite the filenames);
//   - NEW: any other duplicate, including a third file joining a KNOWN pair.
// Files that do not match the `NNNN-` convention are listed as advisory
// notes, never as failures.
//
// Enforcement: the default mode remains report-only for authors inspecting
// the corpus. `--strict` blocks NEW collisions and stale baseline entries. The
// canonical `diary-identity` proof gate invokes strict mode; its registered
// drift trigger covers `diaries/`, and the scheduled complete backstop files
// an idempotent ticket if a NEW collision reaches main.
//
// Updating the baseline: when a historical alias is deliberately resolved
// with a reviewed reference migration, edit KNOWN_COLLISIONS so it again
// matches the on-disk truth, and say why in the commit that changes it. Never
// add a NEW collision to the baseline just to silence it.
//
// Recommendation for future numbering (concurrency-safe, aligned with
// AGENTS.md "use the next available number"): before claiming a number, run
// `git fetch origin` and take the next number above the union of
// `git ls-files diaries/` and `git ls-tree -r --name-only origin/main
// diaries/` — the local checkout alone is not enough on a fast-moving
// `main`. Land the diary promptly after claiming, expect to rebase+retry,
// and re-check the prefix if the push is rejected. Run this script after
// rebasing to confirm the claim survived.
//
// Exit codes: 0 always by default. With `--strict`, exit 1 only when a NEW
// collision (or a malformed baseline entry) is present; KNOWN collisions
// never fail. Exit 2 means the scan itself could not run.
//
// Usage: node scripts/check-diary-identity.mjs [--strict] [--json]

import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIARIES_DIR = join(ROOT, 'diaries');
const PREFIX_PATTERN = /^(\d{4})-.+\.md$/;

// Historical collision baseline, verified against the corpus on 2026-08-08.
// Keys are numeric prefixes; values are the complete, sorted set of files
// known to share that prefix. A prefix collision is KNOWN only when the
// observed file set is exactly this set.
export const KNOWN_COLLISIONS = Object.freeze({
  '0022': Object.freeze([
    '0022-backend-bakeoff.diary.md',
    '0022-catalog-lens.diary.md',
  ]),
  '0042': Object.freeze([
    '0042-a2-group-chat-sweep.diary.md',
    '0042-triage-graph-zero-bakeoff.diary.md',
  ]),
  '0043': Object.freeze([
    '0043-a1-offline-notebook-sweep.diary.md',
    '0043-latency-kanban-zero-bakeoff.diary.md',
  ]),
  '0044': Object.freeze([
    '0044-a3-planning-board-sweep.diary.md',
    '0044-contention-calendar-zero-bakeoff.diary.md',
  ]),
  '0045': Object.freeze([
    '0045-a4-events-sweep.diary.md',
    '0045-private-incident-room-zero-bakeoff.diary.md',
  ]),
  '0046': Object.freeze([
    '0046-a5-ai-research-room-sweep.diary.md',
    '0046-field-notebook-zero-bakeoff.diary.md',
  ]),
  '0047': Object.freeze([
    '0047-a6-ops-ledger-sweep.diary.md',
    '0047-fleet-observatory-zero-bakeoff.diary.md',
  ]),
  '0048': Object.freeze([
    '0048-upload-bakeoff-clip-locker.diary.md',
    '0048-upload-bakeoff-faceplate.diary.md',
  ]),
  '0054': Object.freeze([
    '0054-instance-fork-fleet-dogfood.diary.md',
    '0054-triage-graph-successor.diary.md',
  ]),
  '0058': Object.freeze([
    '0058-messaging-snapback.diary.md',
    '0058-relay-room-expo-backend-bakeoff.diary.md',
  ]),
  '0065': Object.freeze([
    '0065-fleet-observatory-move1.diary.md',
    '0065-rematch-published-closure-bakeoff.diary.md',
  ]),
});

function log(msg) {
  process.stdout.write(`[diary-identity] ${msg}\n`);
}

function sameFileSet(left, right) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

/**
 * Scan a diaries directory and classify every duplicated numeric prefix.
 * Returns { collisions, unconventional } where each collision is
 * { prefix, files, classification: 'known' | 'new' } and unconventional is
 * the list of .md filenames that do not carry a NNNN- prefix.
 */
export function auditDiaryIdentities({ diariesDir = DIARIES_DIR } = {}) {
  const byPrefix = new Map();
  const unconventional = [];
  for (const name of readdirSync(diariesDir).sort()) {
    if (!name.endsWith('.md')) continue;
    const match = PREFIX_PATTERN.exec(name);
    if (!match) {
      unconventional.push(name);
      continue;
    }
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(name);
  }

  const collisions = [];
  for (const [prefix, files] of byPrefix) {
    if (files.length < 2) continue;
    const known = KNOWN_COLLISIONS[prefix];
    collisions.push({
      prefix,
      files,
      classification: known && sameFileSet(files, [...known].sort()) ? 'known' : 'new',
    });
  }
  collisions.sort((left, right) => left.prefix.localeCompare(right.prefix));

  // Baseline hygiene: a baseline entry whose files no longer all exist is
  // stale and should be pruned when the resolution lands.
  const staleBaseline = [];
  for (const [prefix, files] of Object.entries(KNOWN_COLLISIONS)) {
    const observed = byPrefix.get(prefix) ?? [];
    if (!files.every((name) => observed.includes(name))) staleBaseline.push(prefix);
  }

  return { collisions, unconventional, staleBaseline };
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes('--strict');
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg !== '--strict' && arg !== '--json');
  if (unknown.length > 0) {
    process.stderr.write(`[diary-identity] unknown argument(s): ${unknown.join(' ')}\n`);
    process.stderr.write('usage: node scripts/check-diary-identity.mjs [--strict] [--json]\n');
    process.exit(2);
  }
  if (!existsSync(DIARIES_DIR)) {
    process.stderr.write(`[diary-identity] diaries directory missing: ${DIARIES_DIR}\n`);
    process.exit(2);
  }

  const { collisions, unconventional, staleBaseline } = auditDiaryIdentities();
  const fresh = collisions.filter((entry) => entry.classification === 'new');

  if (json) {
    process.stdout.write(`${JSON.stringify({ collisions, unconventional, staleBaseline }, null, 2)}\n`);
  } else {
    for (const entry of collisions) {
      const tag = entry.classification === 'known' ? 'KNOWN' : 'NEW';
      log(`${tag} collision ${entry.prefix}:`);
      for (const file of entry.files) log(`  diaries/${file}`);
    }
    for (const name of unconventional) {
      log(`note: diaries/${name} does not match the NNNN-slug.diary.md convention`);
    }
    for (const prefix of staleBaseline) {
      log(`note: baseline entry ${prefix} no longer matches the directory; prune KNOWN_COLLISIONS`);
    }
    if (collisions.length === 0) log('no duplicated diary prefixes');
    else {
      log(
        `${collisions.length} duplicated prefix(es): ` +
        `${collisions.length - fresh.length} known (baseline), ${fresh.length} new`,
      );
    }
    if (fresh.length > 0) {
      log(
        'NEW collisions ambiguate "Diary NNNN" references. Prefer renumbering the newest file ' +
        'before other documents cite it: fetch origin, take the next number above the union of ' +
        'local and origin/main diaries/, and land promptly.',
      );
    }
  }

  if (strict && (fresh.length > 0 || staleBaseline.length > 0)) process.exit(1);
  process.exit(0);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main();
}
