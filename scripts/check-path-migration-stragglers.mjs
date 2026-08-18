#!/usr/bin/env node

// @ref LLP 0276#phases — the checked Phase 0 manifest advances through
// explicit migration epochs; each move activates its stale-path families in
// the same series, while pre-flip proof remains non-vacuously schema-checked.

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = 'scripts/path-migration-manifest.v1.json';
const DIAGNOSTIC = 'PATH_MIGRATION_STRAGGLER';

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeRepoPath(path) {
  return path.split(sep).join('/').replace(/^\.\//u, '');
}

function isExactRepositoryFilePath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
    && !path.startsWith('/')
    && !path.startsWith('../')
    && !path.includes('\\')
    && !/[{}*…]/u.test(path)
    && !path.endsWith('/');
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function parseArguments(argv) {
  const result = { epoch: null, paths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--epoch') {
      if (!argv[index + 1]) throw new Error('--epoch requires an epoch id');
      result.epoch = argv[index + 1];
      index += 1;
    } else if (argument === '--path') {
      if (!argv[index + 1]) throw new Error('--path requires a repository-relative path');
      result.paths.push(argv[index + 1]);
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write(
        'Usage: node scripts/check-path-migration-stragglers.mjs [--epoch ID] [--path REPO_PATH ...]\n',
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return result;
}

function loadManifest() {
  const absolute = join(ROOT, MANIFEST_PATH);
  let source;
  try {
    source = readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new Error(`${MANIFEST_PATH} is unreadable: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${MANIFEST_PATH} is not valid JSON: ${error.message}`);
  }
}

function validateManifest(manifest) {
  const errors = [];
  const expect = (condition, message) => {
    if (!condition) errors.push(message);
  };
  expect(manifest?.schemaVersion === 'snapback.path-migration-manifest.v1', 'schemaVersion must be snapback.path-migration-manifest.v1');
  expect(Array.isArray(manifest?.epoch?.order) && manifest.epoch.order.length === 5, 'epoch.order must name the five migration epochs');
  const epochs = Array.isArray(manifest?.epoch?.order) ? manifest.epoch.order : [];
  expect(new Set(epochs).size === epochs.length, 'epoch.order contains duplicate ids');
  expect(epochs.includes(manifest?.epoch?.current), 'epoch.current is not present in epoch.order');

  const categories = Array.isArray(manifest?.categories) ? manifest.categories : [];
  expect(categories.length === 14, 'categories must preserve all 14 survey sections');
  const categoryIds = new Set(categories.map((entry) => entry?.id));
  expect(categoryIds.size === categories.length, 'categories contain duplicate ids');
  for (let section = 1; section <= 14; section += 1) {
    expect(categories.some((entry) => entry?.surveySection === String(section)), `missing survey category ${section}`);
  }

  const consumers = Array.isArray(manifest?.consumers) ? manifest.consumers : [];
  expect(consumers.length > 0, 'consumers must not be empty');
  const consumerIds = new Set();
  const consumerFileMoves = (repositoryPath) => repositoryPath === 'build.rs'
    || repositoryPath.startsWith('src/')
    || /^tests\/[^/]+\.rs$/u.test(repositoryPath)
    || repositoryPath.startsWith('examples/')
    || repositoryPath.startsWith('tools/agent-safe-baseline-worker/')
    || repositoryPath.startsWith('cloudflare/');
  for (const [index, consumer] of consumers.entries()) {
    const label = consumer?.id ?? `index ${index}`;
    expect(typeof consumer?.id === 'string' && consumer.id.length > 0, `consumer ${label} has no stable id`);
    expect(!consumerIds.has(consumer?.id), `duplicate consumer id ${label}`);
    consumerIds.add(consumer?.id);
    expect(categoryIds.has(consumer?.category), `consumer ${label} has unknown category ${consumer?.category}`);
    expect(Array.isArray(consumer?.consumerFiles) && consumer.consumerFiles.length > 0, `consumer ${label} has no consumerFiles`);
    for (const repositoryPath of consumer?.consumerFiles ?? []) {
      expect(isExactRepositoryFilePath(repositoryPath), `consumer ${label} has non-file consumerFiles entry ${repositoryPath}`);
    }
    if (consumer?.targetFiles !== undefined) {
      expect(Array.isArray(consumer.targetFiles), `consumer ${label} targetFiles must be an array`);
      for (const repositoryPath of consumer?.targetFiles ?? []) {
        expect(isExactRepositoryFilePath(repositoryPath), `consumer ${label} has non-file targetFiles entry ${repositoryPath}`);
      }
    }
    if ((consumer?.consumerFiles ?? []).some(consumerFileMoves)) {
      expect(Array.isArray(consumer?.targetFiles) && consumer.targetFiles.length > 0, `consumer ${label} moves a consumer file but has no targetFiles`);
    }
    for (const field of ['consumer', 'currentPathExpression', 'targetExpression', 'verification', 'surveyCitation']) {
      expect(typeof consumer?.[field] === 'string' && consumer[field].length > 0, `consumer ${label} has no ${field}`);
    }
    expect(epochs.includes(consumer?.applyByEpoch), `consumer ${label} has unknown applyByEpoch ${consumer?.applyByEpoch}`);
  }
  const sortedIds = [...consumerIds].sort(compareText);
  expect(
    consumers.map((consumer) => consumer.id).every((id, index) => id === sortedIds[index]),
    'consumers must be sorted by stable id',
  );

  const projections = Array.isArray(manifest?.searchProjections) ? manifest.searchProjections : [];
  const requiredProjections = [
    'scripts',
    'workflow-yaml',
    'policy-record-json',
    'cargo-manifests',
    'rust-source',
    'guide',
    'docs-process',
  ];
  expect(projections.length === requiredProjections.length, 'searchProjections must contain exactly seven named projections');
  const projectionIds = new Set(projections.map((entry) => entry?.id));
  for (const id of requiredProjections) expect(projectionIds.has(id), `missing search projection ${id}`);

  const patterns = Array.isArray(manifest?.stalePathPatterns) ? manifest.stalePathPatterns : [];
  expect(patterns.length === 7, 'stalePathPatterns must contain the seven survey patterns');
  const patternIds = new Set();
  for (const pattern of patterns) {
    expect(typeof pattern?.id === 'string' && pattern.id.length > 0, 'stale pattern has no id');
    expect(!patternIds.has(pattern?.id), `duplicate stale pattern ${pattern?.id}`);
    patternIds.add(pattern?.id);
    expect(epochs.includes(pattern?.activeFrom), `pattern ${pattern?.id} has unknown activeFrom ${pattern?.activeFrom}`);
    expect(Array.isArray(pattern?.projections) && pattern.projections.length > 0, `pattern ${pattern?.id} has no projections`);
    for (const projection of pattern?.projections ?? []) {
      expect(projectionIds.has(projection), `pattern ${pattern?.id} names unknown projection ${projection}`);
    }
    try {
      new RegExp(pattern?.regex, pattern?.flags ?? 'u');
    } catch (error) {
      errors.push(`pattern ${pattern?.id} has invalid regex: ${error.message}`);
    }
  }

  const immutableIds = new Set((manifest?.exceptions?.immutableProvenanceCategories ?? []).map((entry) => entry.id));
  for (const id of ['llp-tombstones', 'closed-issues', 'demo-diaries', 'llp-reviews']) {
    expect(immutableIds.has(id), `missing immutable provenance exception ${id}`);
  }
  expect((manifest?.exceptions?.namedNegativeFixtures ?? []).length === 4, 'namedNegativeFixtures must preserve the four surveyed fixture categories');
  const topLevelFixtureRule = (manifest?.exceptions?.namedNegativeFixtures ?? [])
    .find((entry) => entry.id === 'top-level-test-fixture-builders');
  expect(Array.isArray(topLevelFixtureRule?.files) && topLevelFixtureRule.files.length > 0, 'top-level-test-fixture-builders must enumerate exact files');
  expect(!topLevelFixtureRule?.pattern && !topLevelFixtureRule?.prefix, 'top-level-test-fixture-builders must not use a pattern or prefix');
  for (const repositoryPath of topLevelFixtureRule?.files ?? []) {
    expect(isExactRepositoryFilePath(repositoryPath), `top-level-test-fixture-builders has non-file entry ${repositoryPath}`);
    expect(repositoryPath !== 'tests/ci_workflows_v0.mjs', 'tests/ci_workflows_v0.mjs must not be exempt');
  }
  expect((manifest?.exceptions?.namedDatedEvidence ?? []).length === 4, 'namedDatedEvidence must preserve the four surveyed evidence categories');
  expect((manifest?.surveySpotChecks ?? []).length >= 15, 'surveySpotChecks must retain at least 15 repository checks');
  expect(Array.isArray(manifest?.surveyCorrections), 'surveyCorrections must be an array');

  return errors.sort(compareText);
}

function validateConsumerFiles(manifest, root = ROOT) {
  const errors = [];
  for (const consumer of manifest.consumers) {
    for (const repositoryPath of consumer.consumerFiles) {
      const absolute = join(root, repositoryPath);
      if (!existsSync(absolute)) {
        errors.push(`consumer ${consumer.id} consumerFiles entry does not exist pre-flip: ${repositoryPath}`);
      } else if (!statSync(absolute).isFile()) {
        errors.push(`consumer ${consumer.id} consumerFiles entry is not a file: ${repositoryPath}`);
      }
    }
  }
  return errors.sort(compareText);
}

function validateEpochAssignments(manifest) {
  const errors = [];
  const epochIndex = new Map(manifest.epoch.order.map((epoch, index) => [epoch, index]));
  const earliestTargetEpoch = (repositoryPath) => {
    if (/^targets\/cloudflare\//u.test(repositoryPath)) return 'phase-3';
    if (/^crates\/(?!snapback\/(?:src|tests)\/|snapback\/(?:Cargo\.toml|build\.rs)$)/u.test(repositoryPath)
      || /^crates\/snapback\/examples\//u.test(repositoryPath)) return 'phase-2';
    if (/^crates\/snapback\/(?:src|tests)\//u.test(repositoryPath)
      || /^crates\/snapback\/(?:Cargo\.toml|build\.rs)$/u.test(repositoryPath)) return 'phase-1';
    return 'pre-flip';
  };
  for (const consumer of manifest.consumers) {
    for (const repositoryPath of consumer.targetFiles ?? []) {
      const earliest = earliestTargetEpoch(repositoryPath);
      if (epochIndex.get(consumer.applyByEpoch) < epochIndex.get(earliest)) {
        errors.push(
          `consumer ${consumer.id} applies at ${consumer.applyByEpoch} before target file ${repositoryPath} can exist (${earliest})`,
        );
      }
    }
  }
  return errors.sort(compareText);
}

function validateEpochShape(epoch, root = ROOT) {
  const isDirectory = (repositoryPath) => {
    const absolute = join(root, repositoryPath);
    return existsSync(absolute) && statSync(absolute).isDirectory();
  };
  const errors = [];
  const requireDirectory = (repositoryPath) => {
    if (!isDirectory(repositoryPath)) errors.push(`${epoch} requires directory ${repositoryPath}/`);
  };
  const forbidDirectory = (repositoryPath) => {
    if (isDirectory(repositoryPath)) errors.push(`${epoch} forbids directory ${repositoryPath}/`);
  };

  if (epoch === 'pre-flip') {
    requireDirectory('src');
    forbidDirectory('crates/snapback/src');
  } else if (epoch === 'phase-1' || epoch === 'phase-2') {
    requireDirectory('crates/snapback/src');
    forbidDirectory('src');
    requireDirectory('cloudflare');
    forbidDirectory('targets/cloudflare');
  } else if (epoch === 'phase-3' || epoch === 'post-migration') {
    requireDirectory('crates/snapback/src');
    forbidDirectory('src');
    requireDirectory('targets/cloudflare');
    forbidDirectory('cloudflare');
  }
  return errors.sort(compareText);
}

function walkFiles(rootPath, predicate, { followSymlinkDirectories = false } = {}) {
  const absoluteRoot = join(ROOT, rootPath);
  if (!existsSync(absoluteRoot)) return [];
  const files = [];
  const visit = (absolute, repositoryPath) => {
    const entries = readdirSync(absolute, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const childAbsolute = join(absolute, entry.name);
      const childRepoPath = repositoryPath ? `${repositoryPath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(childAbsolute, childRepoPath);
      } else if (entry.isSymbolicLink() && followSymlinkDirectories) {
        let target;
        try {
          target = statSync(childAbsolute);
        } catch {
          continue;
        }
        if (target.isDirectory()) visit(childAbsolute, childRepoPath);
        else if (target.isFile() && predicate(childRepoPath)) files.push(childRepoPath);
      } else if (entry.isFile() && predicate(childRepoPath)) {
        files.push(childRepoPath);
      }
    }
  };
  const rootStat = lstatSync(absoluteRoot);
  if (rootStat.isDirectory() || (rootStat.isSymbolicLink() && statSync(absoluteRoot).isDirectory())) {
    visit(absoluteRoot, rootPath);
  } else if (predicate(rootPath)) {
    files.push(rootPath);
  }
  return files.sort(compareText);
}

function exactExisting(paths) {
  return paths.filter((path) => existsSync(join(ROOT, path))).sort(compareText);
}

function projectionFiles() {
  const files = new Map();
  const add = (projection, paths) => {
    for (const path of paths) {
      if (path === MANIFEST_PATH) continue;
      const projections = files.get(path) ?? new Set();
      projections.add(projection);
      files.set(path, projections);
    }
  };

  add('scripts', walkFiles('scripts', (path) => /\.(?:mjs|sh|txt|json)$/u.test(path)));
  add('scripts', exactExisting(['ref-check']));
  add('scripts', walkFiles('.githooks', () => true));

  add('workflow-yaml', walkFiles('.github/workflows', (path) => path.endsWith('.yml')));
  add('workflow-yaml', exactExisting(['tests/ci_workflows_v0.mjs']));

  add('policy-record-json', exactExisting([
    'scripts/local-proof-selection-policy.v1.json',
    'scripts/js-production-audit-dispositions.v1.json',
    'guide/published-closure.json',
  ]));
  add(
    'policy-record-json',
    readdirSync(ROOT).filter((name) => /^ownership\..+\.json$/u.test(name)).sort(compareText),
  );
  add(
    'policy-record-json',
    walkFiles('cloudflare/generated', (path) => /\/deployment-identity\..+\.json$/u.test(path)),
  );
  add(
    'policy-record-json',
    walkFiles('targets/cloudflare/generated', (path) => /\/deployment-identity\..+\.json$/u.test(path)),
  );
  add('policy-record-json', walkFiles('tests/acceptance', (path) => /\.(?:json|md)$/u.test(path)));
  add('policy-record-json', walkFiles('tests/conformance', (path) => /\.(?:json|md)$/u.test(path)));

  add('cargo-manifests', exactExisting(['Cargo.toml']));
  add('cargo-manifests', walkFiles('crates', (path) => /\/Cargo\.toml$/u.test(path)));
  add('cargo-manifests', walkFiles('tools', (path) => /\/Cargo\.toml$/u.test(path)));

  add('rust-source', walkFiles('crates', (path) => path.endsWith('.rs')));
  add('rust-source', walkFiles('src', (path) => path.endsWith('.rs')));
  add('guide', walkFiles('guide', (path) => path.endsWith('.md') && !path.endsWith('.generated.md')));

  add('docs-process', exactExisting(['AGENTS.md']));
  add('docs-process', walkFiles('skills', () => true, { followSymlinkDirectories: true }));
  add(
    'docs-process',
    readdirSync(join(ROOT, 'llp')).filter((name) => /^\d+.*\.md$/u.test(name)).map((name) => `llp/${name}`).sort(compareText),
  );
  add(
    'docs-process',
    readdirSync(join(ROOT, 'issues')).filter((name) => name.endsWith('.md')).map((name) => `issues/${name}`).sort(compareText),
  );

  return files;
}

function matchesRule(repositoryPath, rule) {
  if (rule.file && repositoryPath === rule.file) return true;
  if (rule.files && rule.files.includes(repositoryPath)) return true;
  if (rule.prefix && repositoryPath.startsWith(rule.prefix)) return true;
  if (rule.pattern && new RegExp(rule.pattern, 'u').test(repositoryPath)) return true;
  return false;
}

function exemptionFor(repositoryPath, manifest) {
  const groups = [
    ['immutable-provenance', manifest.exceptions.immutableProvenanceCategories],
    ['negative-fixture', manifest.exceptions.namedNegativeFixtures],
    ['dated-evidence', manifest.exceptions.namedDatedEvidence],
  ];
  for (const [category, rules] of groups) {
    for (const rule of rules) {
      if (matchesRule(repositoryPath, rule)) return `${category}/${rule.id}`;
    }
  }
  return null;
}

function targetedProjection(repositoryPath, allProjectionFiles) {
  const projections = allProjectionFiles.get(repositoryPath);
  if (projections) return projections;
  const result = new Set();
  if (/^scripts\/.+\.(?:mjs|sh|txt|json)$/u.test(repositoryPath) || repositoryPath === 'ref-check' || /^\.githooks\/[^/]+$/u.test(repositoryPath)) result.add('scripts');
  if (/^\.github\/workflows\/[^/]+\.yml$/u.test(repositoryPath) || repositoryPath === 'tests/ci_workflows_v0.mjs') result.add('workflow-yaml');
  if (repositoryPath === 'Cargo.toml' || /^crates\/[^/]+\/Cargo\.toml$/u.test(repositoryPath) || /^tools\/.+\/Cargo\.toml$/u.test(repositoryPath)) result.add('cargo-manifests');
  if (/^(?:src|crates\/.+)\/.+\.rs$/u.test(repositoryPath)) result.add('rust-source');
  if (/^guide\/.+\.md$/u.test(repositoryPath) && !repositoryPath.endsWith('.generated.md')) result.add('guide');
  if (repositoryPath === 'AGENTS.md' || /^skills\//u.test(repositoryPath) || /^llp\/\d+.*\.md$/u.test(repositoryPath) || /^issues\/[^/]+\.md$/u.test(repositoryPath)) result.add('docs-process');
  if (/^(?:tests\/(?:acceptance|conformance)\/.+\.(?:json|md)|ownership\..+\.json|(?:cloudflare|targets\/cloudflare)\/generated\/deployment-identity\..+\.json)$/u.test(repositoryPath)) result.add('policy-record-json');
  return result;
}

function historicalLineStates(lines, markers, repositoryPath) {
  const skipped = new Set();
  const findings = [];
  let inHistoricalSection = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const hasBegin = line.includes(markers.beginMarker);
    const hasEnd = line.includes(markers.endMarker);
    const hasInline = line.includes(markers.inlineMarker) && !hasBegin && !hasEnd;
    if (hasBegin) {
      if (inHistoricalSection) {
        findings.push({
          path: repositoryPath,
          line: index + 1,
          projection: 'historical-sections',
          pattern: 'nested-begin-marker',
          snippet: line.trim(),
        });
      }
      inHistoricalSection = true;
      skipped.add(index);
      continue;
    }
    if (hasEnd) {
      if (!inHistoricalSection) {
        findings.push({
          path: repositoryPath,
          line: index + 1,
          projection: 'historical-sections',
          pattern: 'unmatched-end-marker',
          snippet: line.trim(),
        });
      }
      inHistoricalSection = false;
      skipped.add(index);
      continue;
    }
    if (inHistoricalSection || hasInline) skipped.add(index);
  }
  if (inHistoricalSection) {
    findings.push({
      path: repositoryPath,
      line: lines.length,
      projection: 'historical-sections',
      pattern: 'unterminated-begin-marker',
      snippet: markers.beginMarker,
    });
  }
  return { skipped, findings };
}

function scanCommonPatterns({ source, repositoryPath, projection, patterns, manifest, epochIndex }) {
  const lines = source.split(/\r?\n/u);
  const historical = historicalLineStates(lines, manifest.exceptions.historicalSections, repositoryPath);
  const findings = [...historical.findings];
  for (let index = 0; index < lines.length; index += 1) {
    if (historical.skipped.has(index)) continue;
    const line = lines[index];
    for (const pattern of patterns) {
      if (!pattern.projections.includes(projection)) continue;
      if (epochIndex < manifest.epoch.order.indexOf(pattern.activeFrom)) continue;
      if (pattern.fileSuffixes && !pattern.fileSuffixes.some((suffix) => repositoryPath.endsWith(suffix))) continue;
      let matches = false;
      if (pattern.matcher === 'normalized-root-path') {
        const joinedStringFragments = line.replace(/(["'])\s*\+\s*(["'])/gu, '');
        const tokenRegex = /(?:^|[^a-zA-Z0-9_./-])((?:\.{1,2}\/)*src\/)/gu;
        matches = [...joinedStringFragments.matchAll(tokenRegex)].some((match) => {
          const normalized = match[1].replace(/^(?:\.{1,2}\/)+/u, '');
          return normalized.startsWith('src/');
        });
      } else {
        const regex = new RegExp(pattern.regex, pattern.flags ?? 'u');
        matches = regex.test(line);
      }
      if (matches) {
        findings.push({
          path: repositoryPath,
          line: index + 1,
          projection,
          pattern: pattern.id,
          snippet: line.trim().slice(0, 240),
        });
      }
    }
  }
  return findings;
}

function scanCargoManifest(source, repositoryPath, epochIndex, manifest) {
  if (epochIndex < manifest.epoch.order.indexOf('phase-1')) return [];
  const findings = [];
  const addMatches = (regex, pattern) => {
    for (const match of source.matchAll(regex)) {
      findings.push({
        path: repositoryPath,
        line: lineNumberAt(source, match.index),
        projection: 'cargo-manifests',
        pattern,
        snippet: match[0].trim().slice(0, 240),
      });
    }
  };
  if (repositoryPath === 'Cargo.toml') {
    addMatches(/^\s*\[package\]\s*$/gmu, 'root-package-table');
    addMatches(/^\s*\[\[(?:bin|test)\]\]\s*$/gmu, 'root-target-table');
    if (!/^\s*\[workspace\]\s*$/mu.test(source)) {
      findings.push({ path: repositoryPath, line: 1, projection: 'cargo-manifests', pattern: 'root-workspace-table-missing', snippet: '[workspace] is required after Phase 1' });
    }
    if (!/default-members\s*=\s*\[[\s\S]*?"crates\/snapback"[\s\S]*?\]/u.test(source)) {
      findings.push({ path: repositoryPath, line: 1, projection: 'cargo-manifests', pattern: 'default-member-missing', snippet: 'default-members must include crates/snapback after Phase 1' });
    }
  } else {
    addMatches(/path\s*=\s*["']vendor\//gu, 'nested-vendor-path-missing-root-hop');
    addMatches(/path\s*=\s*["'](?:\.\.\/)+(?:src|tests|examples)\//gu, 'target-path-escapes-to-old-root');
  }
  return findings;
}

function scanRustSource(source, repositoryPath, epochIndex, manifest) {
  if (epochIndex < manifest.epoch.order.indexOf('phase-1')) return [];
  const findings = [];
  const rootCorpora = [
    'admin-ui', 'brand', 'cloudflare', 'control-catalog', 'demos', 'guide',
    'issues', 'node_modules', 'packages', 'schemas', 'target', 'tests', 'vendor',
  ];
  const rootAlternation = rootCorpora.join('|');
  const includeRegex = new RegExp(
    `include_(?:str|bytes)!\\s*\\(\\s*["']((?:\\.\\.\\/)+(?:${rootAlternation})(?:\\/[^"']*)?)["']`,
    'gu',
  );
  for (const match of source.matchAll(includeRegex)) {
    const literal = match[1];
    const rootName = literal.replace(/^(?:\.\.\/)+/u, '').split('/')[0];
    const resolvedTarget = normalizeRepoPath(relative(ROOT, resolve(ROOT, dirname(repositoryPath), literal)));
    if (resolvedTarget !== rootName && !resolvedTarget.startsWith(`${rootName}/`)) {
      findings.push({
        path: repositoryPath,
        line: lineNumberAt(source, match.index),
        projection: 'rust-source',
        pattern: 'include-root-hop',
        snippet: literal,
      });
    }
  }
  const manifestDirRegex = new RegExp(
    `env!\\(\\s*["']CARGO_MANIFEST_DIR["']\\s*\\)[\\s\\S]{0,160}?(?:\\.join\\(\\s*["']|,\\s*["']\\/?)(?!\\.\\.\\/\\.\\.\\/)(?:${rootAlternation})(?:\\/|["'])`,
    'gu',
  );
  for (const match of source.matchAll(manifestDirRegex)) {
    findings.push({
      path: repositoryPath,
      line: lineNumberAt(source, match.index),
      projection: 'rust-source',
      pattern: 'cargo-manifest-dir-root-hop',
      snippet: match[0].replace(/\s+/gu, ' ').trim().slice(0, 240),
    });
  }

  const helperRegex = /\bfn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*->\s*(?:(?:std::path::)?PathBuf)\s*\{([^}]*?CARGO_MANIFEST_DIR[^}]*)\}/gu;
  for (const helper of source.matchAll(helperRegex)) {
    const helperName = helper[1];
    const escapedHelper = helperName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const addHelperMatches = (regex) => {
      for (const match of source.matchAll(regex)) {
        findings.push({
          path: repositoryPath,
          line: lineNumberAt(source, match.index),
          projection: 'rust-source',
          pattern: 'manifest-dir-helper-root-hop',
          snippet: match[0].replace(/\s+/gu, ' ').trim().slice(0, 240),
        });
      }
    };
    addHelperMatches(new RegExp(
      `\\b${escapedHelper}\\s*\\(\\s*\\)[^;]{0,120}?\\.join\\(\\s*["'](?:${rootAlternation})(?:\\/|["'])`,
      'gu',
    ));
    const bindingRegex = new RegExp(
      `\\blet\\s+([a-zA-Z_][a-zA-Z0-9_]*)\\s*=\\s*${escapedHelper}\\s*\\(\\s*\\)\\s*;`,
      'gu',
    );
    for (const binding of source.matchAll(bindingRegex)) {
      const variable = binding[1].replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      const tail = source.slice(binding.index + binding[0].length);
      const useRegex = new RegExp(
        `\\b${variable}\\.join\\(\\s*["'](?:${rootAlternation})(?:\\/|["'])`,
        'gu',
      );
      for (const use of tail.matchAll(useRegex)) {
        findings.push({
          path: repositoryPath,
          line: lineNumberAt(source, binding.index + binding[0].length + use.index),
          projection: 'rust-source',
          pattern: 'manifest-dir-helper-root-hop',
          snippet: use[0].replace(/\s+/gu, ' ').trim().slice(0, 240),
        });
      }
    }
  }
  return findings;
}

function workspaceHasDefaultMember() {
  if (!existsSync(join(ROOT, 'Cargo.toml'))) return false;
  const source = readFileSync(join(ROOT, 'Cargo.toml'), 'utf8');
  return /default-members\s*=\s*\[[\s\S]*?"crates\/snapback"[\s\S]*?\]/u.test(source);
}

function scanGuide(source, repositoryPath, epochIndex, manifest) {
  const findings = [];
  const lines = source.split(/\r?\n/u);
  const phase1 = manifest.epoch.order.indexOf('phase-1');
  const phase2 = manifest.epoch.order.indexOf('phase-2');
  const phase3 = manifest.epoch.order.indexOf('phase-3');
  const sourcePatterns = [
    { active: phase1, id: 'source-root-src', regex: /\bsource=src\//u },
    { active: phase1, id: 'source-root-rust-test', regex: /\bsource=tests\/[a-z_0-9]+\.rs\b/u },
    { active: phase2, id: 'source-root-example', regex: /\bsource=examples\//u },
    { active: phase2, id: 'source-tools-root', regex: /\bsource=tools\//u },
    { active: phase3, id: 'source-cloudflare-root', regex: /\bsource=cloudflare\//u },
  ];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of sourcePatterns) {
      if (epochIndex >= pattern.active && pattern.regex.test(line)) {
        findings.push({ path: repositoryPath, line: index + 1, projection: 'guide', pattern: pattern.id, snippet: line.trim().slice(0, 240) });
      }
    }
    if (/^\s*```/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (epochIndex >= phase1 && inFence && /(^|\s)cargo\s+run(?:\s|$)/u.test(line) && !workspaceHasDefaultMember()) {
      findings.push({ path: repositoryPath, line: index + 1, projection: 'guide', pattern: 'cargo-run-without-default-member', snippet: line.trim().slice(0, 240) });
    }
  }
  return findings;
}

function findingComparator(left, right) {
  return compareText(left.path, right.path)
    || left.line - right.line
    || compareText(left.projection, right.projection)
    || compareText(left.pattern, right.pattern)
    || compareText(left.snippet, right.snippet);
}

function main() {
  let arguments_;
  try {
    arguments_ = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}_USAGE: ${error.message}\n`);
    process.exit(2);
  }

  let manifest;
  try {
    manifest = loadManifest();
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}_MANIFEST_INVALID: ${error.message}\n`);
    process.exit(1);
  }
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length > 0) {
    for (const error of manifestErrors) process.stderr.write(`${DIAGNOSTIC}_MANIFEST_INVALID: ${error}\n`);
    process.exit(1);
  }

  const assignmentErrors = validateEpochAssignments(manifest);
  if (assignmentErrors.length > 0) {
    for (const error of assignmentErrors) process.stderr.write(`${DIAGNOSTIC}_MANIFEST_INVALID: ${error}\n`);
    process.exit(1);
  }

  const epochShapeErrors = validateEpochShape(manifest.epoch.current);
  if (epochShapeErrors.length > 0) {
    for (const error of epochShapeErrors) process.stderr.write(`${DIAGNOSTIC}_EPOCH_SHAPE_INVALID: ${error}\n`);
    process.exit(1);
  }

  if (manifest.epoch.current === 'pre-flip') {
    const consumerFileErrors = validateConsumerFiles(manifest);
    if (consumerFileErrors.length > 0) {
      for (const error of consumerFileErrors) process.stderr.write(`${DIAGNOSTIC}_MANIFEST_INVALID: ${error}\n`);
      process.exit(1);
    }
  }

  const epoch = arguments_.epoch ?? manifest.epoch.current;
  const epochIndex = manifest.epoch.order.indexOf(epoch);
  if (epochIndex === -1) {
    process.stderr.write(`${DIAGNOSTIC}_USAGE: unknown epoch ${epoch}\n`);
    process.exit(2);
  }

  const allProjectionFiles = projectionFiles();
  const selectedFiles = new Map();
  let exemptFiles = 0;
  let authorityFiles = 0;
  if (arguments_.paths.length > 0) {
    const normalizedTargets = [...new Set(arguments_.paths.map(normalizeRepoPath))].sort(compareText);
    for (const repositoryPath of normalizedTargets) {
      const absolute = resolve(ROOT, repositoryPath);
      const relativePath = normalizeRepoPath(relative(ROOT, absolute));
      if (relativePath.startsWith('../') || relativePath === '..' || !existsSync(absolute) || !statSync(absolute).isFile()) {
        process.stderr.write(`${DIAGNOSTIC}_USAGE: --path must name an existing file inside the repository: ${repositoryPath}\n`);
        process.exit(2);
      }
      if (repositoryPath === MANIFEST_PATH) {
        authorityFiles += 1;
        continue;
      }
      const exemption = exemptionFor(repositoryPath, manifest);
      if (exemption) {
        exemptFiles += 1;
        continue;
      }
      const projections = targetedProjection(repositoryPath, allProjectionFiles);
      if (projections.size === 0) {
        process.stderr.write(`${DIAGNOSTIC}_USAGE: --path is outside the seven checked projections: ${repositoryPath}\n`);
        process.exit(2);
      }
      selectedFiles.set(repositoryPath, projections);
    }
  } else if (epochIndex > 0) {
    for (const [repositoryPath, projections] of [...allProjectionFiles.entries()].sort(([left], [right]) => compareText(left, right))) {
      if (exemptionFor(repositoryPath, manifest)) {
        exemptFiles += 1;
        continue;
      }
      selectedFiles.set(repositoryPath, projections);
    }
  }

  const findings = [];
  for (const [repositoryPath, projections] of selectedFiles) {
    let source;
    try {
      source = readFileSync(join(ROOT, repositoryPath), 'utf8');
    } catch (error) {
      findings.push({ path: repositoryPath, line: 1, projection: 'file-read', pattern: 'unreadable', snippet: error.message });
      continue;
    }
    for (const projection of [...projections].sort(compareText)) {
      findings.push(...scanCommonPatterns({
        source,
        repositoryPath,
        projection,
        patterns: manifest.stalePathPatterns,
        manifest,
        epochIndex,
      }));
      if (projection === 'cargo-manifests') findings.push(...scanCargoManifest(source, repositoryPath, epochIndex, manifest));
      if (projection === 'rust-source') findings.push(...scanRustSource(source, repositoryPath, epochIndex, manifest));
      if (projection === 'guide') findings.push(...scanGuide(source, repositoryPath, epochIndex, manifest));
    }
  }

  const uniqueFindings = [...new Map(
    findings.sort(findingComparator).map((finding) => [
      `${finding.path}\u0000${finding.line}\u0000${finding.projection}\u0000${finding.pattern}\u0000${finding.snippet}`,
      finding,
    ]),
  ).values()].sort(findingComparator);
  if (uniqueFindings.length > 0) {
    for (const finding of uniqueFindings) {
      process.stderr.write(
        `${DIAGNOSTIC} ${finding.path}:${finding.line} [${finding.projection}/${finding.pattern}] ${finding.snippet}\n`,
      );
    }
    process.stderr.write(
      `path-migration straggler gate: FAIL (epoch=${epoch}, manifestRows=${manifest.consumers.length}, scannedFiles=${selectedFiles.size}, exemptFiles=${exemptFiles}, authorityFiles=${authorityFiles}, findings=${uniqueFindings.length})\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `path-migration straggler gate: PASS (epoch=${epoch}, manifestRows=${manifest.consumers.length}, scannedFiles=${selectedFiles.size}, exemptFiles=${exemptFiles}, authorityFiles=${authorityFiles}, findings=0)\n`,
  );
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) main();

export {
  scanCommonPatterns,
  scanRustSource,
  validateConsumerFiles,
  validateEpochAssignments,
  validateEpochShape,
  validateManifest,
};
