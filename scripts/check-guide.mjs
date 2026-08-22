#!/usr/bin/env node
// Guide corpus checks: snippet transclusion-match, consistency (frontmatter,
// links, capability index + surface joins, reachability, bootstrap-command
// resolvability), content-bound review freshness (warning-only), and manifest
// staleness.
// @ref LLP 0061#3-verification-snippets-that-ran — the registered guide checks.
//
// Usage: node scripts/check-guide.mjs [--snippets] [--consistency]
// (no flags = run everything; this is also the fast docs-only entry point)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FLAT_PATH,
  MANIFEST_PATH,
  buildFlatGuide,
  buildManifest,
  buildSectionFlatGuides,
  checkBootstrapResolvability,
  checkCapabilityIndex,
  checkFreshness,
  checkGuideMcpProjection,
  checkLinks,
  checkPublishedClosure,
  checkReachability,
  checkSnippets,
  loadCorpus,
  listFlatSectionPaths,
  parseCapabilityIndex,
  repoRoot,
} from './guide-lib.mjs';

const flags = new Set(process.argv.slice(2));
const runAll = flags.size === 0;
const runSnippets = runAll || flags.has('--snippets');
const runConsistency = runAll || flags.has('--consistency');
const root = repoRoot();
const require = createRequire(import.meta.url);
const results = [];
const warnings = [];
const infos = [];

const dependencyEntries = new Map([
  ['ajv', 'ajv/dist/2020.js'],
  ['typescript', 'typescript'],
]);
const selectedDependencies = runConsistency ? [...dependencyEntries.keys()] : [];
const unavailableDependencies = new Set(selectedDependencies.filter((name) => {
  try {
    require.resolve(dependencyEntries.get(name), { paths: [root] });
    return false;
  } catch {
    return true;
  }
}));

let environmentPrecondition = null;
if (runConsistency && !existsSync(join(root, 'node_modules'))) {
  environmentPrecondition = 'node_modules is absent';
} else if (unavailableDependencies.size > 0) {
  environmentPrecondition = `required packages unavailable: ${[...unavailableDependencies].join(', ')}`;
}
if (environmentPrecondition) {
  console.error(
    `[guide-check] environment precondition: ${environmentPrecondition}; `
      + 'run `bun install --frozen-lockfile`',
  );
}

function errorDetail(error) {
  return `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim()
    || error?.message
    || String(error);
}

function missingDependencyFrom(detail) {
  return detail.match(/Cannot find package ['"]([^'"]+)['"]/u)?.[1]
    ?? detail.match(/Cannot find module ['"]([^'"]+)['"]/u)?.[1]
    ?? null;
}

function isDemoArtifactPrecondition(message) {
  return message.includes('run `./scripts/check-generated-artifacts` first')
    || message.includes('this is Exact/Contract-generated output; run `bun install');
}

function addResult(name, status, { qualifier = null, errors = [], preconditions = [] } = {}) {
  const result = { name, status, qualifier, errors, preconditions };
  results.push(result);
  return result;
}

function addCollectedResult(name, errors) {
  const preconditions = errors.filter(isDemoArtifactPrecondition);
  const contentErrors = errors.filter((message) => !isDemoArtifactPrecondition(message));
  if (contentErrors.length > 0) {
    return addResult(name, 'FAILED', { errors: contentErrors, preconditions });
  }
  if (preconditions.length > 0) {
    return addResult(name, 'PRECONDITION', {
      qualifier: 'generated demo artifacts unavailable',
      preconditions,
    });
  }
  return addResult(name, 'PASS');
}

function runCollectedCheck(name, action) {
  const errors = [];
  try {
    const value = action(errors);
    const result = addCollectedResult(name, errors);
    return { value, result };
  } catch (error) {
    const detail = errorDetail(error);
    const dependency = missingDependencyFrom(detail);
    if (dependency) {
      return {
        value: null,
        result: addResult(name, 'SKIPPED', {
          qualifier: `dependency unavailable: ${dependency}`,
        }),
      };
    }
    return {
      value: null,
      result: addResult(name, 'FAILED', { errors: [detail] }),
    };
  }
}

function runExternalCheck(name, script, args = [], dependencies = []) {
  const unavailable = dependencies.filter((dependency) => unavailableDependencies.has(dependency));
  if (unavailable.length > 0) {
    return addResult(name, 'SKIPPED', {
      qualifier: `dependency unavailable: ${unavailable.join(', ')}`,
    });
  }
  try {
    execFileSync(process.execPath, [join(root, script), ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return addResult(name, 'PASS');
  } catch (error) {
    const detail = errorDetail(error);
    const dependency = missingDependencyFrom(detail);
    if (dependency) {
      unavailableDependencies.add(dependency);
      return addResult(name, 'SKIPPED', {
        qualifier: `dependency unavailable: ${dependency}`,
      });
    }
    return addResult(name, 'FAILED', { errors: [detail] });
  }
}

if (runConsistency) {
  // @ref LLP 0061#3-verification-snippets-that-ran — illustrative shell
  // examples are source-bound to the packaged/Clap CLI, publication closure,
  // and template package-manager authorities without executing the examples.
  runExternalCheck(
    'guide shell/CLI source binding',
    'scripts/check-guide-shell-commands.mjs',
    ['--strict'],
  );
  runExternalCheck(
    'diagnostics registry',
    'scripts/generate-diagnostics-registry.mjs',
    ['--check'],
  );
  runExternalCheck(
    'symbol registry',
    'scripts/generate-symbol-registry.mjs',
    ['--check'],
    ['typescript'],
  );
  runExternalCheck(
    'asset client minimal example packed typecheck',
    'scripts/check-guide-asset-client-example.mjs',
    ['--check'],
    ['typescript'],
  );
  runExternalCheck(
    'auth settlement packed proof',
    'scripts/check-guide-auth-settlement-packed-proof.mjs',
    ['--check'],
  );
}

let corpus = null;
try {
  corpus = loadCorpus(root);
  warnings.push(...corpus.warnings);
  infos.push(...corpus.infos);
  addCollectedResult('guide corpus', corpus.errors);
} catch (error) {
  addResult('guide corpus', 'FAILED', { errors: [errorDetail(error)] });
}

let snippetRecords = new Map();
let snippetResult = null;
if (runSnippets) {
  if (!corpus) {
    snippetResult = addResult('snippet transclusions', 'SKIPPED', {
      qualifier: 'prerequisite unavailable: guide corpus',
    });
  } else {
    const check = runCollectedCheck(
      'snippet transclusions',
      (errors) => checkSnippets(root, corpus.pageBodies, errors),
    );
    snippetRecords = check.value ?? new Map();
    snippetResult = check.result;
  }
}

let surfaces = { routes: 0, hostOps: 0 };
let index = null;
if (runConsistency) {
  let graph = null;
  if (!corpus) {
    addResult('guide links', 'SKIPPED', { qualifier: 'prerequisite unavailable: guide corpus' });
    addResult('guide reachability', 'SKIPPED', { qualifier: 'prerequisite unavailable: guide links' });
  } else {
    const links = runCollectedCheck('guide links', (errors) => {
      const localWarnings = [];
      const value = checkLinks(root, corpus.pageBodies, errors, localWarnings);
      warnings.push(...localWarnings);
      return value;
    });
    graph = links.value;
    if (graph) {
      runCollectedCheck('guide reachability', (errors) => {
        checkReachability(corpus.pagePaths, graph, errors);
      });
    } else {
      addResult('guide reachability', 'SKIPPED', {
        qualifier: 'prerequisite unavailable: guide links',
      });
    }
  }

  const parsed = runCollectedCheck(
    'capability index parsing',
    (errors) => parseCapabilityIndex(root, errors),
  );
  index = parsed.value;
  if (index && corpus) {
    const joined = runCollectedCheck(
      'capability and surface joins',
      (errors) => checkCapabilityIndex(root, index, corpus.pageInfo, errors),
    );
    if (joined.value) surfaces = joined.value;
  } else {
    addResult('capability and surface joins', 'SKIPPED', {
      qualifier: `prerequisite unavailable: ${!index ? 'capability index' : 'guide corpus'}`,
    });
  }

  if (corpus) {
    runCollectedCheck('published-closure fence', (errors) => {
      checkPublishedClosure(root, corpus.pageInfo, corpus.pageBodies, errors);
    });
    runCollectedCheck('bootstrap command resolvability', (errors) => {
      checkBootstrapResolvability(corpus.pageBodies, errors);
    });
    runCollectedCheck('authority freshness', () => {
      const localWarnings = [];
      const localInfos = [];
      checkFreshness(root, corpus.pageInfo, localWarnings, localInfos);
      warnings.push(...localWarnings);
      infos.push(...localInfos);
    });
  } else {
    for (const name of [
      'published-closure fence',
      'bootstrap command resolvability',
      'authority freshness',
    ]) {
      addResult(name, 'SKIPPED', { qualifier: 'prerequisite unavailable: guide corpus' });
    }
  }

  // @ref LLP 0184#3-completeness-and-parity-rules — rule 9: Guide control
  // inventories and counts are checked projections of the build catalog.
  runExternalCheck(
    'control-catalog Guide projection',
    'scripts/generate-control-catalog.mjs',
    ['--check'],
    ['ajv'],
  );
  // @ref LLP 0186#amendment-2026-08-06-w2-rosetta-section--worked-example-tier —
  // OQ6's mechanism: generated/checked projections, not hand-maintained drift.
  runExternalCheck('Rosetta record', 'scripts/check-rosetta.mjs', ['--check']);
  // @ref LLP 0259#4-firstreadprofilev1--budget-the-bytes-the-carrier-sends —
  // FirstReadProfileV1 budgets, packet transclusion identity, and the
  // negative-vocabulary fence are part of the Guide consistency gate.
  runExternalCheck('first-read profiles', 'scripts/check-first-read.mjs', ['--check']);
  runExternalCheck(
    'retrieval-eval static routing',
    'scripts/check-retrieval-eval.mjs',
    ['--check'],
  );
  runExternalCheck('generated API cold signatures', 'tests/generated-api-reference-v1.mjs');
}

if (runAll) {
  if (!corpus || !index) {
    addResult('guide manifest and MCP projection', 'SKIPPED', {
      qualifier: `prerequisite unavailable: ${!corpus ? 'guide corpus' : 'capability index'}`,
    });
    addResult('guide flat projections', 'SKIPPED', {
      qualifier: `prerequisite unavailable: ${!corpus ? 'guide corpus' : 'capability index'}`,
    });
  } else {
    let expected = null;
    let expectedSectionFlats = null;
    const manifestCheck = runCollectedCheck('guide manifest and MCP projection', (errors) => {
      expected = buildManifest(root, corpus.pageInfo, snippetRecords, index, surfaces);
      let actual = null;
      try {
        actual = JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
        checkGuideMcpProjection(root, actual, errors);
      } catch {
        errors.push(`${MANIFEST_PATH}: missing or invalid JSON — run node scripts/generate-guide-manifest.mjs`);
      }
      if (actual && JSON.stringify(actual) !== JSON.stringify(expected)) {
        if (snippetResult?.status === 'PRECONDITION') {
          errors.push(
            `${MANIFEST_PATH}: comparison requires the missing generated demo artifacts; `
              + 'materialize those preconditions before attributing manifest drift',
          );
        } else {
          errors.push(`${MANIFEST_PATH}: stale — run node scripts/generate-guide-manifest.mjs`);
        }
      }
    });
    if (
      snippetResult?.status === 'PRECONDITION'
      && manifestCheck.result.status === 'FAILED'
      && manifestCheck.result.errors.every((message) => message.includes('comparison requires the missing'))
    ) {
      manifestCheck.result.status = 'PRECONDITION';
      manifestCheck.result.qualifier = 'generated demo artifacts unavailable';
      manifestCheck.result.preconditions = manifestCheck.result.errors;
      manifestCheck.result.errors = [];
    }

    if (!expected) {
      addResult('guide flat projections', 'SKIPPED', {
        qualifier: 'prerequisite unavailable: expected guide manifest',
      });
    } else {
      runCollectedCheck('guide flat projections', (errors) => {
        const expectedFlat = buildFlatGuide(root, expected, corpus.pageInfo);
        expectedSectionFlats = buildSectionFlatGuides(root, expected, corpus.pageInfo);
        let flatStale = false;
        try {
          flatStale = readFileSync(join(root, FLAT_PATH), 'utf8') !== expectedFlat;
        } catch {
          flatStale = true;
        }
        if (flatStale) {
          errors.push(`${FLAT_PATH}: stale or missing — run node scripts/generate-guide-manifest.mjs`);
        }
        for (const { path, content } of expectedSectionFlats.values()) {
          let stale = false;
          try {
            stale = readFileSync(join(root, path), 'utf8') !== content;
          } catch {
            stale = true;
          }
          if (stale) {
            errors.push(`${path}: stale or missing — run node scripts/generate-guide-manifest.mjs`);
          }
        }
        const expectedSectionPaths = new Set(
          [...expectedSectionFlats.values()].map(({ path }) => path),
        );
        for (const path of listFlatSectionPaths(root)) {
          if (!expectedSectionPaths.has(path)) {
            errors.push(`${path}: orphaned section flat — run node scripts/generate-guide-manifest.mjs`);
          }
        }
      });
    }
  }
}

for (const line of infos) console.log(`[guide-check] info: ${line}`);
for (const line of warnings) console.log(`[guide-check] warning: ${line}`);
console.log('[guide-check] status list:');
for (const result of results) {
  const qualifier = result.qualifier ? ` (${result.qualifier})` : '';
  console.log(`[guide-check] ${result.status}${qualifier} — ${result.name}`);
  for (const precondition of result.preconditions) {
    console.log(`[guide-check]   precondition: ${precondition}`);
  }
  for (const error of result.errors) {
    console.log(`[guide-check]   error: ${error}`);
  }
}

const counts = Object.fromEntries(
  ['PASS', 'FAILED', 'SKIPPED', 'PRECONDITION'].map((status) => [
    status,
    results.filter((result) => result.status === status).length,
  ]),
);
const blocking = Boolean(environmentPrecondition)
  || counts.FAILED > 0
  || counts.SKIPPED > 0
  || counts.PRECONDITION > 0;
const pageCount = corpus?.pagePaths.length ?? 0;
const snippetCount = [...snippetRecords.values()].flat().length;
console.log(
  `[guide-check] ${blocking ? 'FAILED' : 'ok'} — ${counts.PASS} passed, ${counts.FAILED} failed, `
    + `${counts.SKIPPED} skipped, ${counts.PRECONDITION} preconditions; `
    + `${pageCount} pages, ${snippetCount} snippets, ${surfaces.routes} routes + `
    + `${surfaces.hostOps} host-ops joined, ${warnings.length} warnings`,
);
process.exit(blocking ? 1 : 0);
