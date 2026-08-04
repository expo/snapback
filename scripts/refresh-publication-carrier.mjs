#!/usr/bin/env node

// The local capability publication carriers pin the sha256 of every executor,
// schema, and client source they were published from, and src/manifest.rs
// plus each conformance test pin the carrier's own digest. Any landing that
// edits one of those sources leaves the chain stale and the conformance
// corpus refuses.
//
// Refreshing is mechanical — recompute the source digests, then the carrier
// digest, then rewrite the files that carry them — but it had been done
// by hand (573ce92b, 03a3ee77) and drifted three times in one day. This is
// that same edit, scripted, so a commit touching a pinned source can refresh
// in one command instead of chasing digests across files.
//
// It only ever copies digests computed from the working tree. It cannot
// weaken the gate: the tests still assert the full chain afterwards, and a
// carrier whose sources genuinely should not have changed is a review
// question, not something this script can hide.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CARRIERS = [
  {
    carrier: 'src/local-relation-activity-publication.v1.json',
    test: 'tests/conformance/relation-activity-publication-v1.mjs',
  },
  {
    carrier: 'src/local-sequence-allocation-publication.v1.json',
    test: 'tests/conformance/sequence-allocation-publication-v1.mjs',
    receipt: 'tests/conformance/sequence-allocation-publication-v1.receipt.json',
  },
];

const digestOf = (path) =>
  `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

const MANIFEST = join(ROOT, 'src/manifest.rs');

for (const entry of CARRIERS) {
  const carrierPath = join(ROOT, entry.carrier);
  const readers = [MANIFEST, join(ROOT, entry.test)];
  const carrierDigestBefore = digestOf(carrierPath);
  let carrierText = readFileSync(carrierPath, 'utf8');
  const carrier = JSON.parse(carrierText);
  let manifestText = readFileSync(MANIFEST, 'utf8');

  const refreshed = [];
  for (const group of ['executorSourceSha256', 'schemaSourceSha256', 'clientSourceSha256']) {
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
  if (entry.receipt && carrier.qualificationReceiptSha256) {
    const actual = digestOf(join(ROOT, entry.receipt));
    if (actual !== carrier.qualificationReceiptSha256) {
      carrierText = carrierText.split(carrier.qualificationReceiptSha256).join(actual);
      manifestText = manifestText.split(carrier.qualificationReceiptSha256).join(actual);
      refreshed.push(entry.receipt);
    }
  }

  if (refreshed.length === 0) {
    console.log(`[refresh-publication-carrier] ok: ${entry.carrier} — every pinned source already matches`);
    continue;
  }

  writeFileSync(carrierPath, carrierText);
  const carrierDigestAfter = digestOf(carrierPath);
  writeFileSync(MANIFEST, manifestText);
  for (const reader of readers) {
    const text = readFileSync(reader, 'utf8');
    if (!text.includes(carrierDigestBefore)) {
      throw new Error(`${reader} does not carry the pre-refresh carrier digest; refusing a partial rewrite`);
    }
    writeFileSync(reader, text.split(carrierDigestBefore).join(carrierDigestAfter));
  }

  for (const source of refreshed) console.log(`[refresh-publication-carrier] refreshed ${source}`);
  console.log(
    `[refresh-publication-carrier] ${entry.carrier}: ${carrierDigestBefore.slice(7, 19)} -> ${carrierDigestAfter.slice(7, 19)}`,
  );
  console.log(`[refresh-publication-carrier] now run node ${entry.test}`);
}
