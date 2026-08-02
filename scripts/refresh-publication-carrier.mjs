#!/usr/bin/env node

// The local capability publication carrier pins the sha256 of every executor
// and schema source it was published from, and src/manifest.rs plus the
// conformance test pin the carrier's own digest. Any landing that edits one
// of those sources leaves the chain stale and
// tests/conformance/relation-activity-publication-v1.mjs refuses.
//
// Refreshing is mechanical — recompute the source digests, then the carrier
// digest, then rewrite the three files that carry them — but it had been done
// by hand (573ce92b, 03a3ee77) and drifted three times in one day. This is
// that same edit, scripted, so a commit touching src/local.rs can refresh in
// one command instead of chasing digests across three files.
//
// It only ever copies digests computed from the working tree. It cannot
// weaken the gate: the test still asserts the full chain afterwards, and a
// carrier whose sources genuinely should not have changed is a review
// question, not something this script can hide.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CARRIER = join(ROOT, 'src/local-relation-activity-publication.v1.json');
const CARRIER_READERS = [
  join(ROOT, 'src/manifest.rs'),
  join(ROOT, 'tests/conformance/relation-activity-publication-v1.mjs'),
];

const digestOf = (path) =>
  `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

const carrierDigestBefore = digestOf(CARRIER);
let carrierText = readFileSync(CARRIER, 'utf8');
const carrier = JSON.parse(carrierText);
let manifestText = readFileSync(CARRIER_READERS[0], 'utf8');

const refreshed = [];
for (const group of ['executorSourceSha256', 'schemaSourceSha256']) {
  for (const [source, recorded] of Object.entries(carrier[group] ?? {})) {
    const actual = digestOf(join(ROOT, source));
    if (actual === recorded) continue;
    // Both the carrier and manifest.rs spell the same digest, so one textual
    // substitution per digest keeps every copy in step without reformatting
    // either file.
    carrierText = carrierText.split(recorded).join(actual);
    manifestText = manifestText.split(recorded).join(actual);
    refreshed.push(source);
  }
}

if (refreshed.length === 0) {
  console.log('[refresh-publication-carrier] ok: every pinned source already matches');
  process.exit(0);
}

writeFileSync(CARRIER, carrierText);
const carrierDigestAfter = digestOf(CARRIER);
writeFileSync(CARRIER_READERS[0], manifestText);
for (const reader of CARRIER_READERS) {
  const text = readFileSync(reader, 'utf8');
  if (!text.includes(carrierDigestBefore)) {
    throw new Error(`${reader} does not carry the pre-refresh carrier digest; refusing a partial rewrite`);
  }
  writeFileSync(reader, text.split(carrierDigestBefore).join(carrierDigestAfter));
}

for (const source of refreshed) console.log(`[refresh-publication-carrier] refreshed ${source}`);
console.log(
  `[refresh-publication-carrier] carrier ${carrierDigestBefore.slice(7, 19)} -> ${carrierDigestAfter.slice(7, 19)}`,
);
console.log('[refresh-publication-carrier] now run node tests/conformance/relation-activity-publication-v1.mjs');
