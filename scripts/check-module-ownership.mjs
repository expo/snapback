#!/usr/bin/env node

import {
  globSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0199#author-rulings-accepted-2026-08-08-charlie-cheever — OQ5
// requires a blocking ownership-manifest ratchet that can land over the
// pre-extraction graph without blessing later upward dependencies.
// @ref LLP 0175#d22-affected-proof — Rust and ownership-authority changes
// select this cheap textual gate through the checked local-proof policy.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'ownership.manifest.json');
const BASELINE_PATH = join(ROOT, 'ownership.baseline.json');
const DIAGNOSTIC = 'SNAPBACK_MODULE_OWNERSHIP_VIOLATION';
const MANIFEST_SCHEMA = 'snapback.module-ownership-manifest.v1';
const BASELINE_SCHEMA = 'snapback.module-ownership-baseline.v1';
const OWNER_ORDINALS = new Map([
  ['shared-contract-types-leaf', 0],
  ['generation-activation-coordinator', 1],
  ['storage-migration-kernel', 2],
  ['sync-realtime-engine', 3],
  ['background-services', 4],
  ['transport-adapters', 5],
  ['embed-facade', 6],
  ['unassigned', null],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(path, label) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`${label} is unreadable at ${repositoryPath(path)}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function repositoryPath(path) {
  return relative(ROOT, path).split(sep).join('/');
}

function validateUniqueStrings(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === 'string' && value.length > 0), `${label} must contain non-empty strings`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
}

export function validateManifest(manifest, rustFiles) {
  assert(manifest?.schemaVersion === MANIFEST_SCHEMA, `manifest schemaVersion must be ${MANIFEST_SCHEMA}`);
  assert(manifest.owners && typeof manifest.owners === 'object' && !Array.isArray(manifest.owners), 'manifest owners must be an object');
  assert(manifest.modulesByOwner && typeof manifest.modulesByOwner === 'object' && !Array.isArray(manifest.modulesByOwner), 'manifest modulesByOwner must be an object');

  const ownerIds = Object.keys(manifest.owners).sort();
  const expectedOwnerIds = [...OWNER_ORDINALS.keys()].sort();
  assert(JSON.stringify(ownerIds) === JSON.stringify(expectedOwnerIds), `manifest owners must be exactly ${expectedOwnerIds.join(', ')}`);
  assert(
    JSON.stringify(Object.keys(manifest.modulesByOwner).sort()) === JSON.stringify(expectedOwnerIds),
    'modulesByOwner must have exactly one bucket for every owner plus unassigned',
  );

  for (const [owner, ordinal] of OWNER_ORDINALS) {
    const metadata = manifest.owners[owner];
    assert(metadata?.ordinal === ordinal, `${owner} must retain ordinal ${String(ordinal)}`);
    validateUniqueStrings(metadata.allowedDependencies, `${owner}.allowedDependencies`);
    for (const dependency of metadata.allowedDependencies) {
      assert(OWNER_ORDINALS.has(dependency), `${owner} allows unknown dependency owner ${dependency}`);
      assert(dependency !== 'unassigned', `${owner} must not declare unassigned as an allowed dependency`);
      assert(
        Number.isInteger(metadata.rank)
          && Number.isInteger(manifest.owners[dependency].rank)
          && metadata.rank > manifest.owners[dependency].rank,
        `${owner} -> ${dependency} is not downward`,
      );
    }
  }
  assert(manifest.owners.unassigned.rank === null, 'unassigned must not claim a dependency rank');

  const assignment = new Map();
  for (const owner of expectedOwnerIds) {
    const files = manifest.modulesByOwner[owner];
    validateUniqueStrings(files, `modulesByOwner.${owner}`);
    const sorted = [...files].sort();
    assert(JSON.stringify(files) === JSON.stringify(sorted), `modulesByOwner.${owner} must be sorted`);
    for (const path of files) {
      assert(/^src\/(?:[^/]+\/)*[^/]+\.rs$/u.test(path), `invalid Rust module path ${path}`);
      assert(!assignment.has(path), `${path} is assigned to both ${assignment.get(path)} and ${owner}`);
      assignment.set(path, owner);
    }
  }

  assert(rustFiles.length > 0, 'no src/**/*.rs modules found; refusing a vacuous pass');
  const rustSet = new Set(rustFiles);
  const missing = rustFiles.filter((path) => !assignment.has(path));
  const extra = [...assignment.keys()].filter((path) => !rustSet.has(path));
  assert(missing.length === 0, `manifest is missing Rust modules: ${missing.join(', ')}`);
  assert(extra.length === 0, `manifest names absent Rust modules: ${extra.join(', ')}`);

  validateUniqueStrings(manifest.godFiles, 'manifest godFiles');
  for (const path of manifest.godFiles) assert(assignment.has(path), `god file ${path} has no assignment`);

  const mixedModuleScopes = manifest.mixedModuleScopes ?? {};
  assert(typeof mixedModuleScopes === 'object' && !Array.isArray(mixedModuleScopes), 'mixedModuleScopes must be an object');
  for (const [path, scopes] of Object.entries(mixedModuleScopes)) {
    assert(assignment.has(path), `mixed module ${path} has no file-level assignment`);
    assert(Array.isArray(scopes) && scopes.length >= 2, `mixed module ${path} must declare at least two scopes`);
    const scopeOwners = scopes.map((scope) => scope?.owner);
    assert(scopeOwners.every((owner) => OWNER_ORDINALS.has(owner)), `mixed module ${path} has an unknown scope owner`);
    assert(new Set(scopeOwners).size === scopeOwners.length, `mixed module ${path} repeats a scope owner`);
    assert(scopeOwners.includes(assignment.get(path)), `mixed module ${path} must include its file-level analyzer owner`);
    for (const scope of scopes) {
      assert(typeof scope.scope === 'string' && scope.scope.trim().length >= 20, `mixed module ${path} needs substantive scope descriptions`);
    }
  }

  const uncertainAssignments = manifest.uncertainAssignments ?? {};
  assert(typeof uncertainAssignments === 'object' && !Array.isArray(uncertainAssignments), 'uncertainAssignments must be an object');
  for (const [path, note] of Object.entries(uncertainAssignments)) {
    assert(assignment.has(path), `uncertain assignment ${path} has no module assignment`);
    assert(typeof note === 'string' && note.trim().length >= 20, `uncertain assignment ${path} needs a substantive note`);
  }

  return { assignment, godFiles: new Set(manifest.godFiles) };
}

function modulePathForFile(path) {
  const relativePath = path.slice('src/'.length, -'.rs'.length);
  if (relativePath === 'lib' || relativePath === 'main' || relativePath.startsWith('bin/')) return null;
  const segments = relativePath.split('/');
  if (segments.at(-1) === 'mod') segments.pop();
  return segments;
}

function buildModuleIndex(rustFiles) {
  const index = new Map();
  for (const path of rustFiles) {
    const segments = modulePathForFile(path);
    if (!segments || segments.length === 0) continue;
    const modulePath = segments.join('::');
    assert(!index.has(modulePath), `Rust module path ${modulePath} maps to both ${index.get(modulePath)} and ${path}`);
    index.set(modulePath, path);
  }
  return index;
}

function maskRange(text) {
  return text.replace(/[^\n]/gu, ' ');
}

// This is intentionally a lexer-sized mask, not a Rust parser. It removes
// comments and literals before the textual crate:: scan so prose cannot mint
// ownership edges while retaining all code bytes and newlines.
function maskNonCode(source) {
  const output = [];
  let cursor = 0;
  let codeStart = 0;
  const maskThrough = (end) => {
    output.push(source.slice(codeStart, cursor));
    output.push(maskRange(source.slice(cursor, end)));
    cursor = end;
    codeStart = end;
  };

  while (cursor < source.length) {
    if (source.startsWith('//', cursor)) {
      const newline = source.indexOf('\n', cursor + 2);
      maskThrough(newline === -1 ? source.length : newline);
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      let depth = 1;
      let end = cursor + 2;
      while (end < source.length && depth > 0) {
        if (source.startsWith('/*', end)) {
          depth += 1;
          end += 2;
        } else if (source.startsWith('*/', end)) {
          depth -= 1;
          end += 2;
        } else {
          end += 1;
        }
      }
      maskThrough(end);
      continue;
    }

    const rawStart = /^(?:br|rb|r)(#{0,32})"/u.exec(source.slice(cursor, cursor + 36));
    if (rawStart) {
      const terminator = `"${rawStart[1]}`;
      const contentStart = cursor + rawStart[0].length;
      const closing = source.indexOf(terminator, contentStart);
      maskThrough(closing === -1 ? source.length : closing + terminator.length);
      continue;
    }

    const quoteOffset = source[cursor] === '"'
      ? 0
      : (['b', 'c'].includes(source[cursor]) && source[cursor + 1] === '"' ? 1 : -1);
    if (quoteOffset >= 0) {
      let end = cursor + quoteOffset + 1;
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2;
        } else if (source[end] === '"') {
          end += 1;
          break;
        } else {
          end += 1;
        }
      }
      maskThrough(end);
      continue;
    }

    if (source[cursor] === "'") {
      const character = /^'(?:\\(?:.|u\{[0-9A-Fa-f_]+\})|[^'\\\n])'/u.exec(source.slice(cursor, cursor + 20));
      if (character) {
        maskThrough(cursor + character[0].length);
        continue;
      }
    }
    cursor += 1;
  }
  output.push(source.slice(codeStart));
  return output.join('');
}

function tokenizeUseTree(body) {
  return [...body.matchAll(/::|[{},;*]|r#[A-Za-z_][A-Za-z0-9_]*|[A-Za-z_][A-Za-z0-9_]*/gu)]
    .map((match) => match[0]);
}

function useTreePaths(body) {
  const tokens = tokenizeUseTree(body);
  const paths = [];
  let cursor = 0;

  const parseGroup = (prefix) => {
    assert(tokens[cursor] === '{', 'internal grouped-use parser expected {');
    cursor += 1;
    while (cursor < tokens.length && tokens[cursor] !== '}') {
      parseBranch(prefix);
      if (tokens[cursor] === ',') cursor += 1;
    }
    if (tokens[cursor] === '}') cursor += 1;
  };

  const parseBranch = (prefix) => {
    if (tokens[cursor] === '{') {
      parseGroup(prefix);
      return;
    }
    const segments = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (!/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u.test(token) || token === 'as') break;
      cursor += 1;
      if (token === 'self') {
        if (prefix.length + segments.length > 0) paths.push([...prefix, ...segments]);
      } else if (token !== 'super' && token !== 'crate') {
        segments.push(token.replace(/^r#/u, ''));
      }
      if (tokens[cursor] !== '::') break;
      cursor += 1;
      if (tokens[cursor] === '{') {
        parseGroup([...prefix, ...segments]);
        return;
      }
      if (tokens[cursor] === '*') {
        cursor += 1;
        if (prefix.length + segments.length > 0) paths.push([...prefix, ...segments]);
        return;
      }
    }
    if (segments.length > 0) paths.push([...prefix, ...segments]);
    if (tokens[cursor] === 'as') {
      cursor += 1;
      if (/^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u.test(tokens[cursor] ?? '')) cursor += 1;
    }
    while (cursor < tokens.length && ![',', '}'].includes(tokens[cursor])) cursor += 1;
  };

  if (tokens[cursor] === '{') parseGroup([]);
  else parseBranch([]);
  return paths;
}

export function extractCratePaths(source) {
  const code = maskNonCode(source);
  const paths = new Map();
  const remember = (segments) => {
    if (segments.length > 0) paths.set(segments.join('::'), segments);
  };

  const useRanges = [];
  const useStart = /\buse\s+crate\s*::/gu;
  for (const match of code.matchAll(useStart)) {
    const bodyStart = match.index + match[0].length;
    const semicolon = code.indexOf(';', bodyStart);
    if (semicolon === -1) continue;
    useRanges.push([match.index, semicolon + 1]);
    for (const segments of useTreePaths(code.slice(bodyStart, semicolon))) remember(segments);
  }

  const directPattern = /\bcrate\s*::\s*((?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*)/gu;
  let useRangeIndex = 0;
  for (const match of code.matchAll(directPattern)) {
    while (useRanges[useRangeIndex]?.[1] <= match.index) useRangeIndex += 1;
    const activeUseRange = useRanges[useRangeIndex];
    if (activeUseRange && activeUseRange[0] <= match.index && match.index < activeUseRange[1]) continue;
    remember(match[1].split(/\s*::\s*/u).map((segment) => segment.replace(/^r#/u, '')));
  }
  return [...paths.values()];
}

function resolveModuleReference(segments, moduleIndex) {
  for (let length = segments.length; length > 0; length -= 1) {
    const target = moduleIndex.get(segments.slice(0, length).join('::'));
    if (target) return target;
  }
  return null;
}

function compareEdges(left, right) {
  return left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.fromOwner.localeCompare(right.fromOwner)
    || left.toOwner.localeCompare(right.toOwner);
}

function edgeKey(edge) {
  return JSON.stringify([edge.from, edge.fromOwner, edge.to, edge.toOwner]);
}

export function analyzeSources(manifest, sources) {
  const rustFiles = [...sources.keys()].sort();
  const { assignment, godFiles } = validateManifest(manifest, rustFiles);
  const moduleIndex = buildModuleIndex(rustFiles);
  const edges = new Map();
  let unresolvedReferenceCount = 0;

  for (const from of rustFiles) {
    const source = sources.get(from);
    assert(typeof source === 'string', `missing source bytes for ${from}`);
    for (const segments of extractCratePaths(source)) {
      const to = resolveModuleReference(segments, moduleIndex);
      if (!to) {
        unresolvedReferenceCount += 1;
        continue;
      }
      if (to === from) continue;
      const edge = {
        from,
        fromOwner: assignment.get(from),
        to,
        toOwner: assignment.get(to),
      };
      edges.set(edgeKey(edge), edge);
    }
  }

  return {
    assignment,
    edges: [...edges.values()].sort(compareEdges),
    godFiles,
    moduleCount: rustFiles.length,
    unresolvedReferenceCount,
  };
}

function validateBaseline(baseline) {
  assert(baseline?.schemaVersion === BASELINE_SCHEMA, `baseline schemaVersion must be ${BASELINE_SCHEMA}`);
  assert(baseline.manifestSchemaVersion === MANIFEST_SCHEMA, 'baseline manifestSchemaVersion does not match the manifest schema');
  assert(Number.isInteger(baseline.moduleCount) && baseline.moduleCount > 0, 'baseline moduleCount must be non-vacuous');
  assert(Number.isInteger(baseline.edgeCount) && baseline.edgeCount > 0, 'baseline edgeCount must be non-vacuous');
  assert(Array.isArray(baseline.edges), 'baseline edges must be an array');
  assert(baseline.edgeCount === baseline.edges.length, 'baseline edgeCount does not match edges.length');
  const keys = new Set();
  for (const edge of baseline.edges) {
    assert(/^src\/(?:[^/]+\/)*[^/]+\.rs$/u.test(edge?.from ?? ''), 'baseline edge has an invalid from path');
    assert(/^src\/(?:[^/]+\/)*[^/]+\.rs$/u.test(edge?.to ?? ''), 'baseline edge has an invalid to path');
    assert(OWNER_ORDINALS.has(edge.fromOwner), `baseline edge has unknown fromOwner ${edge.fromOwner}`);
    assert(OWNER_ORDINALS.has(edge.toOwner), `baseline edge has unknown toOwner ${edge.toOwner}`);
    const key = edgeKey(edge);
    assert(!keys.has(key), `baseline contains duplicate edge ${edge.from} -> ${edge.to}`);
    keys.add(key);
  }
  assert(
    JSON.stringify(baseline.edges) === JSON.stringify([...baseline.edges].sort(compareEdges)),
    'baseline edges must be sorted',
  );
  return keys;
}

function violationReason(edge, manifest, godFiles) {
  if (edge.fromOwner === edge.toOwner) {
    if (edge.fromOwner === 'unassigned' && godFiles.has(edge.to)) {
      return 'unassigned modules may not add dependencies into an unassigned god-file';
    }
    return null;
  }
  if (manifest.owners[edge.fromOwner].allowedDependencies.includes(edge.toOwner)) return null;
  const allowed = manifest.owners[edge.fromOwner].allowedDependencies;
  const suffix = allowed.length > 0 ? allowed.join(', ') : '(none)';
  const godFile = godFiles.has(edge.to) ? ' into god-file' : '';
  return `${edge.fromOwner} may not depend upward/sideways${godFile} on ${edge.toOwner}; allowed: ${suffix}`;
}

export function findNewViolations(manifest, analysis, baseline) {
  const baselineKeys = validateBaseline(baseline);
  const newEdges = analysis.edges.filter((edge) => !baselineKeys.has(edgeKey(edge)));
  const violations = newEdges
    .map((edge) => ({ ...edge, reason: violationReason(edge, manifest, analysis.godFiles) }))
    .filter((edge) => edge.reason !== null);
  const currentKeys = new Set(analysis.edges.map(edgeKey));
  const staleBaselineEdgeCount = [...baselineKeys].filter((key) => !currentKeys.has(key)).length;
  return { newEdges, staleBaselineEdgeCount, violations };
}

function loadRepositorySources() {
  const rustFiles = globSync('src/**/*.rs', { cwd: ROOT }).sort();
  return new Map(rustFiles.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]));
}

function baselineDocument(analysis) {
  return {
    schemaVersion: BASELINE_SCHEMA,
    manifestSchemaVersion: MANIFEST_SCHEMA,
    moduleCount: analysis.moduleCount,
    edgeCount: analysis.edges.length,
    edges: analysis.edges,
  };
}

function parseArguments(args) {
  if (args.length === 0) return { updateBaseline: false };
  if (args.length === 1 && args[0] === '--update-baseline') return { updateBaseline: true };
  throw new Error('usage: node scripts/check-module-ownership.mjs [--update-baseline]');
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifest = parseJson(MANIFEST_PATH, 'module ownership manifest');
    const analysis = analyzeSources(manifest, loadRepositorySources());

    if (options.updateBaseline) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineDocument(analysis), null, 2)}\n`);
      process.stdout.write(
        `[module-ownership] UPDATED: ${analysis.moduleCount} modules; ${analysis.edges.length} current module edges\n`,
      );
      return;
    }

    const baseline = parseJson(BASELINE_PATH, 'module ownership baseline');
    const result = findNewViolations(manifest, analysis, baseline);
    if (result.violations.length > 0) {
      const details = result.violations.slice(0, 25).map((edge) => (
        `${edge.from} (${edge.fromOwner}) -> ${edge.to} (${edge.toOwner}): ${edge.reason}`
      ));
      if (result.violations.length > details.length) {
        details.push(`... ${result.violations.length - details.length} more violations`);
      }
      throw new Error(`new forbidden module edges:\n- ${details.join('\n- ')}`);
    }

    const assignedCount = [...analysis.assignment.values()].filter((owner) => owner !== 'unassigned').length;
    const crossOwnerCount = analysis.edges.filter((edge) => edge.fromOwner !== edge.toOwner).length;
    process.stdout.write(
      `[module-ownership] PASS: ${analysis.moduleCount} modules (${assignedCount} assigned, `
        + `${analysis.moduleCount - assignedCount} unassigned); ${analysis.edges.length} module edges; `
        + `${crossOwnerCount} cross-owner; ${result.newEdges.length} new allowed; `
        + `${result.staleBaselineEdgeCount} stale baseline; `
        + `${analysis.unresolvedReferenceCount} unresolved inline/root references\n`,
    );
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
