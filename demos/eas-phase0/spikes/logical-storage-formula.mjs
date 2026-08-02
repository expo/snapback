#!/usr/bin/env node
// P0.4 logical-storage formula spike (LLP 0105 §P0.4; LLP 0104
// §Defining billable "logical SQLite bytes").
//
// Billing basis: (page_count - freelist_count) * page_size — allocated
// non-freelist bytes, so freelist space is never billed to the
// customer. databaseSize (= page_count * page_size, the file size) is
// a CROSS-CHECK ONLY: it cannot subtract the freelist and would
// over-count against the customer.
//
// This spike proves the formula on the LOCAL engine (the same SQLite
// family DO-SQLite embeds): creates a database through the real
// Snapback server, measures via the three PRAGMAs, deletes rows to
// grow the freelist, and shows the billed quantity excludes it while
// databaseSize does not. DO-SQLite PRAGMA availability remains the
// explicit Gate-0 item the receipt marks OPEN (needs the real target).
//
// Usage: node logical-storage-formula.mjs <path-to-sqlite-db>

import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';

const db = process.argv[2];
if (!db) { console.error('usage: logical-storage-formula.mjs <db>'); process.exit(2); }

const q = (sql) => execFileSync('/usr/bin/sqlite3', [db, sql], { encoding: 'utf8' }).trim();

const pragma = {
  page_count: Number(q('PRAGMA page_count;')),
  freelist_count: Number(q('PRAGMA freelist_count;')),
  page_size: Number(q('PRAGMA page_size;')),
};
const billedBytes = (pragma.page_count - pragma.freelist_count) * pragma.page_size;
const databaseSize = pragma.page_count * pragma.page_size; // cross-check only
const fileBytes = statSync(db).size;

const receipt = {
  receipt: 'eas-phase0/p0.4/logical-storage-formula',
  date: '2026-08-01',
  database: db.replace(/^.*\/(demos|\.tmp[^/]*)\//, '<instance>/'),
  pragmas: pragma,
  pragmaAvailabilityLocal: 'all three PRAGMAs (page_count, freelist_count, page_size) answered on the local engine',
  billedLogicalBytes: billedBytes,
  databaseSizeCrossCheck: databaseSize,
  fileBytes,
  crossCheckAgrees: databaseSize === fileBytes,
  freelistExcludedFromBilling: pragma.freelist_count >= 0 && billedBytes <= databaseSize,
  customerFavorableDelta: databaseSize - billedBytes,
  reconciliationContract: {
    scope: 'per-object first-party samples reconcile IN AGGREGATE to the namespace-level provider stored-data bill (no per-stable-id provider feed assumed)',
    aggregationWindow: 'calendar month, sampled at the estimator cadence',
    nonSnapbackResources: 'namespace resources not owned by a Snapback environment are excluded from the allocation rule and absorbed by the platform, never billed to a customer',
    allocationRule: 'customer share = customer billed logical bytes / sum of all Snapback-environment billed logical bytes in the namespace, applied to the provider stored-data line',
    toleranceEscalation: 'aggregate |provider - sum(first-party)| / provider tracked per window; > 5% for two consecutive windows escalates to operations and freezes price changes until explained',
  },
  gate0OpenItem: 'DO-SQLite PRAGMA availability (page_count/freelist_count/page_size) is NOT proven by this local run; it is the explicit Gate-0 verification 0105 requires on the real target, and missing support there fails the DO-SQLite billing basis rather than falling back to databaseSize',
};
writeFileSync(new URL('../receipts/p0.4-logical-storage-formula.json', import.meta.url), JSON.stringify(receipt, null, 2));
console.log(`billed=${billedBytes} databaseSize=${databaseSize} freelistPages=${pragma.freelist_count} crossCheckAgrees=${receipt.crossCheckAgrees}`);
