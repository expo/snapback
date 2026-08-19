#!/usr/bin/env node

// The local capability publication carriers pin the sha256 of every executor,
// schema, and client source they were published from. Most carriers are
// digest-pinned by crates/snapback-engine/src/manifest.rs plus their conformance test; the persistent
// store uses a source-owned anchor so its evidence can rotate without changing
// executable or conformance bytes. Any landing that edits a pinned source
// leaves the chain stale and the conformance corpus refuses.
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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CARRIERS = [
  {
    carrier: 'crates/snapback-engine/src/local-relation-activity-publication.v1.json',
    test: 'tests/conformance/relation-activity-publication-v1.mjs',
  },
  {
    carrier: 'crates/snapback-engine/src/local-sequence-allocation-publication.v1.json',
    test: 'tests/conformance/sequence-allocation-publication-v1.mjs',
    receipt: 'tests/conformance/sequence-allocation-publication-v1.receipt.json',
  },
  {
    anchor: 'crates/snapback-engine/src/local-persistent-store-publication.anchor.v1.json',
    carrier: 'crates/snapback-engine/src/local-persistent-store-publication.v1.json',
    test: 'tests/conformance/local-persistent-store-publication-v1.mjs',
    receipts: [
      {
        field: 'qualificationReceiptSha256',
        path: 'tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-06.v1.json',
      },
      {
        field: 'supportingReceiptSha256',
        key: 'triageBudgetFreeze',
        path: 'tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-06.v1.json',
      },
      {
        field: 'supportingReceiptSha256',
        key: 'triageMove1Exit',
        path: 'tests/acceptance/fixtures/triage-graph/move1-exit.2026-08-06.v1.json',
      },
    ],
  },
];

const digestOf = (path) =>
  `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function selectedReceiptPath(receipt) {
  if (receipt.path) return receipt.path;
  const { directory, stem, pairedStem } = receipt.latest;
  const pattern = new RegExp(`^${escapeRegExp(stem)}\\.(\\d{4}-\\d{2}-\\d{2})\\.v1\\.json$`, 'u');
  const names = readdirSync(join(ROOT, directory));
  const pairedDates = pairedStem
    ? new Set(names
        .map((name) => name.match(
          new RegExp(`^${escapeRegExp(pairedStem)}\\.(\\d{4}-\\d{2}-\\d{2})\\.v1\\.json$`, 'u'),
        )?.[1])
        .filter(Boolean))
    : null;
  const candidates = names
    .map((name) => ({ name, match: name.match(pattern) }))
    .filter(({ match }) => match !== null && (pairedDates === null || pairedDates.has(match[1])))
    .sort((left, right) => left.match[1].localeCompare(right.match[1]));
  if (candidates.length === 0) {
    throw new Error(`${directory}: no complete dated ${stem}${pairedStem ? `/${pairedStem}` : ''} receipt is present`);
  }
  return join(directory, candidates.at(-1).name);
}

function requireRecordedDigest(recorded, label) {
  if (typeof recorded !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(recorded)) {
    throw new Error(`${label}: carrier digest is absent or malformed; refusing a partial refresh`);
  }
  return recorded;
}

function selectManifestReceiptPath(manifestText, receipt, selectedPath) {
  if (!receipt.manifestIncludePrefix) return { manifestText, changed: false };
  const pattern = new RegExp(
    `${escapeRegExp(receipt.manifestIncludePrefix)}\\d{4}-\\d{2}-\\d{2}\\.v1\\.json`,
    'gu',
  );
  const matches = manifestText.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `${receipt.manifestIncludePrefix}: expected exactly one Rust include path, found ${matches.length}`,
    );
  }
  const desired = `../${selectedPath}`;
  return {
    manifestText: manifestText.replace(pattern, desired),
    changed: matches[0] !== desired,
  };
}

function selectTestReceiptPath(testText, receipt, selectedPath) {
  if (!receipt.testIncludePrefix) return { testText, changed: false };
  const pattern = new RegExp(
    `${escapeRegExp(receipt.testIncludePrefix)}\\d{4}-\\d{2}-\\d{2}\\.v1\\.json`,
    'gu',
  );
  const matches = testText.match(pattern) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `${receipt.testIncludePrefix}: expected exactly one conformance receipt path, found ${matches.length}`,
    );
  }
  const selectedDate = selectedPath.match(/\.(\d{4}-\d{2}-\d{2})\.v1\.json$/u)?.[1];
  if (!selectedDate) throw new Error(`${selectedPath}: selected receipt has no date`);
  const desired = `${receipt.testIncludePrefix}${selectedDate}.v1.json`;
  return {
    testText: testText.replace(pattern, desired),
    changed: matches[0] !== desired,
  };
}

const MANIFEST = join(ROOT, 'crates/snapback-engine/src/manifest/capabilities.rs');

for (const entry of CARRIERS) {
  const carrierPath = join(ROOT, entry.carrier);
  const readers = entry.anchor
    ? [join(ROOT, entry.anchor)]
    : [MANIFEST, join(ROOT, entry.test)];
  const carrierDigestBefore = digestOf(carrierPath);
  let carrierText = readFileSync(carrierPath, 'utf8');
  const carrier = JSON.parse(carrierText);
  let manifestText = readFileSync(MANIFEST, 'utf8');
  const testPath = join(ROOT, entry.test);
  let testText = readFileSync(testPath, 'utf8');
  if (entry.anchor) {
    const anchor = JSON.parse(readFileSync(join(ROOT, entry.anchor), 'utf8'));
    if (anchor.carrierSha256 !== carrierDigestBefore) {
      throw new Error(`${entry.anchor}: carrier digest does not match ${entry.carrier}`);
    }
  }

  const refreshed = [];
  for (const group of ['executorSourceSha256', 'schemaSourceSha256', 'clientSourceSha256']) {
    for (const [source, recorded] of Object.entries(carrier[group] ?? {})) {
      const actual = digestOf(join(ROOT, source));
      if (actual === recorded) continue;
      // Both the carrier and manifest.rs spell the same digest, so one textual
      // substitution per digest keeps every copy in step without reformatting
      // either file.
      const pinned = requireRecordedDigest(recorded, `${entry.carrier}:${group}.${source}`);
      carrierText = carrierText.split(pinned).join(actual);
      manifestText = manifestText.split(pinned).join(actual);
      refreshed.push(source);
    }
  }
  if (entry.receipt) {
    const recorded = requireRecordedDigest(
      carrier.qualificationReceiptSha256,
      `${entry.carrier}:qualificationReceiptSha256`,
    );
    const actual = digestOf(join(ROOT, entry.receipt));
    if (actual !== recorded) {
      carrierText = carrierText.split(recorded).join(actual);
      manifestText = manifestText.split(recorded).join(actual);
      refreshed.push(entry.receipt);
    }
  }
  for (const receipt of entry.receipts ?? []) {
    const recorded = requireRecordedDigest(receipt.key
      ? carrier[receipt.field]?.[receipt.key]
      : carrier[receipt.field], `${entry.carrier}:${receipt.field}${receipt.key ? `.${receipt.key}` : ''}`);
    const receiptPath = selectedReceiptPath(receipt);
    const selectedManifest = selectManifestReceiptPath(manifestText, receipt, receiptPath);
    manifestText = selectedManifest.manifestText;
    if (selectedManifest.changed) refreshed.push(`${receiptPath} (Rust include selection)`);
    const selectedTest = selectTestReceiptPath(testText, receipt, receiptPath);
    testText = selectedTest.testText;
    if (selectedTest.changed) refreshed.push(`${receiptPath} (conformance selection)`);
    const actual = digestOf(join(ROOT, receiptPath));
    if (actual !== recorded) {
      carrierText = carrierText.split(recorded).join(actual);
      manifestText = manifestText.split(recorded).join(actual);
      refreshed.push(receiptPath);
    }
  }

  if (refreshed.length === 0) {
    console.log(`[refresh-publication-carrier] ok: ${entry.carrier} — every pinned source already matches`);
    continue;
  }

  writeFileSync(carrierPath, carrierText);
  const carrierDigestAfter = digestOf(carrierPath);
  writeFileSync(MANIFEST, manifestText);
  writeFileSync(testPath, testText);
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
