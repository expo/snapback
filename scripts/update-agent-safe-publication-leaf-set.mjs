#!/usr/bin/env node

// Refresh the reviewed, non-content-addressed generated-publication leaf set
// after the measured tree has been committed locally. The pre-push coupling
// then requires this refreshed record to be amended into the same landing.
//
// @ref LLP 0175#same-change-frozen-record-coupling — a mechanical frozen
// record has one named regeneration command and cannot lag its measured tree.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { generatedPublicationPathsAt } from './check-agent-safe-publication.mjs';
import { isContentAddressedFullyCommittedLeaf } from './generated-artifact-policy.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const TEST_PATH = resolve(ROOT, 'tests/agent_safe_publication_checker_v1.mjs');
const BEGIN = '  // BEGIN GENERATED PUBLICATION LEAF SET\n';
const END = '  // END GENERATED PUBLICATION LEAF SET\n';

const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
  cwd: ROOT,
  encoding: 'utf8',
}).trim();
const paths = [...generatedPublicationPathsAt(ROOT, revision).keys()]
  .filter((path) => !isContentAddressedFullyCommittedLeaf(path))
  .sort();
const source = readFileSync(TEST_PATH, 'utf8');
const beginAt = source.indexOf(BEGIN);
const endAt = source.indexOf(END);
if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
  throw new Error('generated publication leaf-set markers are missing or reordered');
}
const singleQuoted = (path) => `'${path.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const rendered = paths.map((path) => `  ${singleQuoted(path)},`).join('\n');
const next = `${source.slice(0, beginAt + BEGIN.length)}${rendered}\n${source.slice(endAt)}`;
writeFileSync(TEST_PATH, next);
console.log(
  `[publication-leaf-set] wrote ${paths.length} reviewed leaves from committed revision ${revision}`,
);
