#!/usr/bin/env node
// Guide corpus checks: snippet transclusion-match, consistency (frontmatter,
// links, capability index + surface joins, reachability), reviewed-commit
// freshness (warning-only), and manifest staleness.
// @ref LLP 0061#3-verification-snippets-that-ran — the registered guide checks.
//
// Usage: node scripts/check-guide.mjs [--snippets] [--consistency]
// (no flags = run everything; this is also the fast docs-only entry point)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  FLAT_PATH,
  MANIFEST_PATH,
  buildFlatGuide,
  buildManifest,
  checkCapabilityIndex,
  checkFreshness,
  checkGuideMcpProjection,
  checkLinks,
  checkPublishedClosure,
  checkReachability,
  checkSnippets,
  loadCorpus,
  parseCapabilityIndex,
  repoRoot,
} from './guide-lib.mjs';

const flags = new Set(process.argv.slice(2));
const runAll = flags.size === 0;
const root = repoRoot();
const { errors, warnings, infos, pagePaths, pageInfo, pageBodies } = loadCorpus(root);

let snippetRecords = new Map();
if (runAll || flags.has('--snippets')) {
  snippetRecords = checkSnippets(root, pageBodies, errors);
}

let surfaces = { routes: 0, hostOps: 0 };
let index = null;
if (runAll || flags.has('--consistency')) {
  const graph = checkLinks(root, pageBodies, errors, warnings);
  checkReachability(pagePaths, graph, errors);
  index = parseCapabilityIndex(root, errors);
  surfaces = checkCapabilityIndex(root, index, pageInfo, errors);
  checkPublishedClosure(root, pageInfo, pageBodies, errors);
  checkFreshness(root, pageInfo, warnings, infos);
  // @ref LLP 0184#3-completeness-and-parity-rules — rule 9: Guide control
  // inventories and counts are checked projections of the build catalog.
  try {
    execFileSync(
      process.execPath,
      [join(root, 'scripts/generate-control-catalog.mjs'), '--check'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    errors.push(`control-catalog Guide projection check failed${detail ? `:\n${detail}` : ''}`);
  }
  // @ref LLP 0186#amendment-2026-08-06-w2-rosetta-section--worked-example-tier —
  // OQ6's mechanism: generated/checked projections, not hand-maintained drift.
  try {
    execFileSync(
      process.execPath,
      [join(root, 'scripts/check-rosetta.mjs'), '--check'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    errors.push(`Rosetta record check failed${detail ? `:\n${detail}` : ''}`);
  }
}

if (runAll && index) {
  const expected = buildManifest(root, pageInfo, snippetRecords, index, surfaces);
  const expectedFlat = buildFlatGuide(root, expected, pageInfo);
  let manifestStale = false;
  try {
    const actual = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
    checkGuideMcpProjection(root, actual, errors);
    const strip = ({ buildIdentity, ...rest }) => rest;
    manifestStale = JSON.stringify(strip(actual)) !== JSON.stringify(strip(expected));
  } catch {
    manifestStale = true;
  }
  if (manifestStale) errors.push(`${MANIFEST_PATH}: stale or missing — run node scripts/generate-guide-manifest.mjs`);
  let flatStale = false;
  try {
    flatStale = readFileSync(join(root, FLAT_PATH), 'utf8') !== expectedFlat;
  } catch {
    flatStale = true;
  }
  if (flatStale) errors.push(`${FLAT_PATH}: stale or missing — run node scripts/generate-guide-manifest.mjs`);
}

for (const line of infos) console.log(`[guide-check] info: ${line}`);
for (const line of warnings) console.log(`[guide-check] warning: ${line}`);
for (const line of errors) console.error(`[guide-check] error: ${line}`);
const snippetCount = [...snippetRecords.values()].flat().length;
console.log(
  `[guide-check] ${errors.length === 0 ? 'ok' : 'FAILED'} — ${pagePaths.length} pages, ${snippetCount} snippets, ` +
    `${surfaces.routes} routes + ${surfaces.hostOps} host-ops joined, ${warnings.length} warnings`,
);
process.exit(errors.length === 0 ? 0 : 1);
