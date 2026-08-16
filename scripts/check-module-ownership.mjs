#!/usr/bin/env node

import {
  existsSync,
  globSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ref LLP 0225#5 — the ownership analyzer and predecessor protocol implement the accepted enforcement arm.
// The gate applies one analyzer to pushed and predecessor snapshots, blocks
// introduced outstanding fingerprints and silent baseline growth, and keeps
// the legacy unassigned bucket shrink-only.
// @ref LLP 0175#d22-affected-proof — Rust and ownership-authority changes
// select this affected ownership gate through the checked local-proof policy.
// @ref LLP 0273#3.1 — content-derived ownership identity uses pinned syn item
// fingerprints; lineage never proves a move or authorizes a discharge.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'ownership.manifest.json');
const BASELINE_PATH = join(ROOT, 'ownership.baseline.json');
const DIAGNOSTIC = 'SNAPBACK_MODULE_OWNERSHIP_VIOLATION';
const MANIFEST_SCHEMA = 'snapback.module-ownership-manifest.v1';
const BASELINE_SCHEMA_V1 = 'snapback.module-ownership-baseline.v1';
const BASELINE_SCHEMA = 'snapback.module-ownership-baseline.v2';
const PREDECESSORS_ENV = 'SNAPBACK_MODULE_OWNERSHIP_PREDECESSORS';
const FROZEN_EDGE_MARKER = 'module-ownership-frozen-edge:';
const AMENDMENT_MARKER = 'module-ownership-amendment:';
const AMENDMENT_GRANT_MARKER = 'module-ownership-amendment-grant:';
const AST_HELPER_MANIFEST = join(ROOT, 'scripts', 'module-ownership-ast', 'Cargo.toml');
const AST_HELPER_BINARY = join(
  ROOT,
  'scripts',
  'module-ownership-ast',
  'target',
  'release',
  process.platform === 'win32'
    ? 'snapback-module-ownership-ast.exe'
    : 'snapback-module-ownership-ast',
);
const AST_VERSION = 'syn-2.0.118+proc-macro2-1.0.106';
const FROZEN_DISPOSITIONS = new Set([
  'analyzer-upgrade',
  'relocation',
  'time-bounded-waiver',
]);
const LINEAGE_KINDS = new Set(['relocation', 'split', 'merge', 'module-relocation']);
const AMENDMENT_KINDS = new Set(['deadline-change', 'lineage-change', 'ownership-correction']);
const AMENDMENT_DIRECTIONS = new Set(['strengthen', 'weaken', 'any']);
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
const astItemCache = new Map();

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function deepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
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

function buildModuleIndex(rustFiles, sources) {
  const index = new Map();
  const moduleSegmentsByFile = new Map();
  const remember = (moduleSegments, path) => {
    if (!moduleSegments || moduleSegments.length === 0) return;
    const modulePath = moduleSegments.join('::');
    assert(
      !index.has(modulePath) || index.get(modulePath) === path,
      `Rust module path ${modulePath} maps to both ${index.get(modulePath)} and ${path}`,
    );
    index.set(modulePath, path);
  };
  for (const path of rustFiles) {
    const segments = modulePathForFile(path);
    if (!segments || segments.length === 0) continue;
    remember(segments, path);
    moduleSegmentsByFile.set(path, segments);
  }
  const pathModule = /#\s*\[\s*path\s*=\s*"([^"]+)"\s*\]\s*(?:pub(?:\s*\([^)]*\))?\s+)?mod\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)\s*;/gu;
  for (const from of rustFiles) {
    const base = modulePathForFile(from) ?? [];
    for (const match of sources.get(from).matchAll(pathModule)) {
      const target = join(dirname(from), match[1]).split(sep).join('/');
      if (!sources.has(target)) continue;
      const alias = [...base, cleanIdentifier(match[2])];
      remember(alias, target);
      moduleSegmentsByFile.set(target, alias);
    }
  }
  return { index, moduleSegmentsByFile };
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

function isIdentifierToken(token) {
  return /^(?:r#)?[A-Za-z_][A-Za-z0-9_]*$/u.test(token ?? '');
}

function cleanIdentifier(token) {
  return token.replace(/^r#/u, '');
}

function useTreeLeaves(body) {
  const tokens = tokenizeUseTree(body);
  const leaves = [];
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
      if (!isIdentifierToken(token) || token === 'as') break;
      cursor += 1;
      segments.push(cleanIdentifier(token));
      if (tokens[cursor] !== '::') break;
      cursor += 1;
      if (tokens[cursor] === '{') {
        parseGroup([...prefix, ...segments]);
        return;
      }
      if (tokens[cursor] === '*') {
        cursor += 1;
        const path = [...prefix, ...segments];
        if (path.length > 0) leaves.push({ path, alias: null, glob: true });
        return;
      }
    }
    const path = [...prefix, ...segments];
    if (path.at(-1) === 'self' && path.length > 1) path.pop();
    let alias = null;
    if (tokens[cursor] === 'as') {
      cursor += 1;
      if (isIdentifierToken(tokens[cursor])) {
        alias = cleanIdentifier(tokens[cursor]);
        cursor += 1;
      }
    }
    if (path.length > 0) leaves.push({ path, alias, glob: false });
    while (cursor < tokens.length && ![',', '}'].includes(tokens[cursor])) cursor += 1;
  };

  if (tokens[cursor] === '{') parseGroup([]);
  else parseBranch([]);
  return leaves;
}

function bracePairs(code) {
  const stack = [];
  const pairs = new Map();
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === '{') stack.push(index);
    if (code[index] === '}' && stack.length > 0) pairs.set(stack.pop(), index);
  }
  return pairs;
}

function inlineModuleContexts(code, fileModuleSegments) {
  const pairs = bracePairs(code);
  const contexts = [];
  const pattern = /\bmod\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)\s*\{/gu;
  for (const match of code.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf('{');
    const end = pairs.get(open);
    if (end === undefined) continue;
    const parent = contexts
      .filter((context) => context.start < open && open < context.end)
      .sort((left, right) => right.start - left.start)[0];
    contexts.push({
      start: open,
      end,
      moduleSegments: [
        ...(parent?.moduleSegments ?? fileModuleSegments),
        cleanIdentifier(match[1]),
      ],
    });
  }
  return contexts;
}

function moduleContextAt(contexts, fileModuleSegments, index) {
  return contexts
    .filter((context) => context.start < index && index < context.end)
    .sort((left, right) => right.start - left.start)[0]?.moduleSegments
    ?? fileModuleSegments;
}

function referenceCandidates(path, moduleSegments) {
  if (path[0] === 'crate') return [path.slice(1)];
  if (path[0] === 'self') return [[...moduleSegments, ...path.slice(1)]];
  if (path[0] === 'super') {
    let parentCount = 0;
    while (path[parentCount] === 'super') parentCount += 1;
    return [[
      ...moduleSegments.slice(0, Math.max(0, moduleSegments.length - parentCount)),
      ...path.slice(parentCount),
    ]];
  }
  const relativeCandidate = [...moduleSegments, ...path];
  const crateCandidate = [...path];
  return relativeCandidate.join('::') === crateCandidate.join('::')
    ? [relativeCandidate]
    : [relativeCandidate, crateCandidate];
}

function extractModuleSyntax(source, fileModuleSegments) {
  const code = maskNonCode(source);
  const contexts = inlineModuleContexts(code, fileModuleSegments);
  const references = [];
  const reexports = [];
  const declaredExports = [];
  const rememberReference = (path, index) => {
    if (path.length === 0) return;
    const moduleContext = moduleContextAt(contexts, fileModuleSegments, index);
    let relativeBase = null;
    if (path[0] === 'self') relativeBase = moduleContext;
    if (path[0] === 'super') {
      let parentCount = 0;
      while (path[parentCount] === 'super') parentCount += 1;
      relativeBase = moduleContext.slice(0, Math.max(0, moduleContext.length - parentCount));
    }
    references.push({
      candidates: referenceCandidates(path, moduleContext),
      ignoreIfUnresolved: relativeBase?.join('::') === fileModuleSegments.join('::'),
      index,
    });
  };

  const useRanges = [];
  const useStart = /\b(pub(?:\s*\([^)]*\))?\s+)?use\b/gu;
  for (const match of code.matchAll(useStart)) {
    const bodyStart = match.index + match[0].length;
    const semicolon = code.indexOf(';', bodyStart);
    if (semicolon === -1) continue;
    useRanges.push([match.index, semicolon + 1]);
    const moduleSegments = moduleContextAt(contexts, fileModuleSegments, match.index);
    for (const leaf of useTreeLeaves(code.slice(bodyStart, semicolon))) {
      const rooted = ['crate', 'self', 'super'].includes(leaf.path[0]);
      if (rooted || match[1]) rememberReference(leaf.path, match.index);
      if (!match[1]) continue;
      const exportedName = leaf.glob
        ? null
        : (leaf.alias ?? leaf.path.at(-1));
      if (exportedName === '_') continue;
      reexports.push({
        namespace: moduleSegments,
        targets: referenceCandidates(leaf.path, moduleSegments),
        exportedName,
        glob: leaf.glob,
      });
    }
  }

  const directPattern = /\b(crate|self|super)\s*::\s*((?:r#)?[A-Za-z_][A-Za-z0-9_]*(?:\s*::\s*(?:r#)?[A-Za-z_][A-Za-z0-9_]*)*)/gu;
  let useRangeIndex = 0;
  for (const match of code.matchAll(directPattern)) {
    while (useRanges[useRangeIndex]?.[1] <= match.index) useRangeIndex += 1;
    const activeUseRange = useRanges[useRangeIndex];
    if (activeUseRange && activeUseRange[0] <= match.index && match.index < activeUseRange[1]) continue;
    rememberReference([
      match[1],
      ...match[2].split(/\s*::\s*/u).map(cleanIdentifier),
    ], match.index);
  }
  const publicItem = /\bpub(?:\s*\([^)]*\))?\s+(?:(?:async|unsafe|const)\s+)*fn\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)|\bpub(?:\s*\([^)]*\))?\s+(?:struct|enum|type|const|static|trait|union)\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)/gu;
  for (const match of code.matchAll(publicItem)) {
    declaredExports.push({
      namespace: moduleContextAt(contexts, fileModuleSegments, match.index),
      name: cleanIdentifier(match[1] ?? match[2]),
    });
  }
  return { declaredExports, references, reexports };
}

// Retained as the narrow public extractor used by earlier fixtures. New code
// should exercise analyzeSources so module-relative context and re-exports are
// included.
export function extractCratePaths(source) {
  const syntax = extractModuleSyntax(source, []);
  const paths = new Map();
  for (const reference of syntax.references) {
    for (const segments of reference.candidates) {
      if (segments.length > 0) paths.set(segments.join('::'), segments);
    }
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

function buildReexportIndex(extracted) {
  const explicit = new Map();
  const globs = new Map();
  const declared = new Map();
  for (const syntax of extracted.values()) {
    for (const item of syntax.declaredExports) {
      const namespace = item.namespace.join('::');
      const names = declared.get(namespace) ?? new Set();
      names.add(item.name);
      declared.set(namespace, names);
    }
    for (const reexport of syntax.reexports) {
      const namespace = reexport.namespace.join('::');
      const index = reexport.glob ? globs : explicit;
      const key = reexport.glob
        ? namespace
        : [...reexport.namespace, reexport.exportedName].join('::');
      const targets = index.get(key) ?? [];
      for (const target of reexport.targets) {
        const targetKey = target.join('::');
        if (!targets.some((candidate) => candidate.join('::') === targetKey)) targets.push(target);
      }
      index.set(key, targets);
    }
  }
  const exportsSymbol = (namespace, symbol, seen = new Set()) => {
    const state = `${namespace}\0${symbol}`;
    if (seen.has(state)) return false;
    const nextSeen = new Set(seen).add(state);
    if (declared.get(namespace)?.has(symbol)) return true;
    if (explicit.has(namespace === '' ? symbol : `${namespace}::${symbol}`)) return true;
    for (const target of globs.get(namespace) ?? []) {
      if (exportsSymbol(target.join('::'), symbol, nextSeen)) return true;
    }
    return false;
  };
  return { declared, explicit, exportsSymbol, globs };
}

function resolveTransitiveModuleReferences(segments, moduleIndex, reexportIndex, cache) {
  const initialKey = segments.join('::');
  if (cache.has(initialKey)) return cache.get(initialKey);
  const targets = new Set();
  const queue = [segments];
  const seen = new Set();
  while (queue.length > 0) {
    const candidate = queue.shift();
    const candidateKey = candidate.join('::');
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    assert(seen.size <= 1_000, `re-export expansion is unbounded from ${initialKey}`);
    let moduleLength = 0;
    let direct = null;
    for (let length = candidate.length; length > 0; length -= 1) {
      const target = moduleIndex.get(candidate.slice(0, length).join('::'));
      if (!target) continue;
      moduleLength = length;
      direct = target;
      break;
    }
    if (direct) targets.add(direct);
    const namespace = candidate.slice(0, moduleLength).join('::');
    const suffix = candidate.slice(moduleLength);
    if (suffix.length === 0) continue;
    const exportKey = [...candidate.slice(0, moduleLength), suffix[0]].join('::');
    for (const target of reexportIndex.explicit.get(exportKey) ?? []) {
      queue.push([...target, ...suffix.slice(1)]);
    }
    for (const target of reexportIndex.globs.get(namespace) ?? []) {
      if (!reexportIndex.exportsSymbol(target.join('::'), suffix[0])) continue;
      queue.push([...target, ...suffix]);
    }
  }
  cache.set(initialKey, targets);
  return targets;
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

export function edgeFingerprint(edge) {
  return `${edge.from} (${edge.fromOwner}) → ${edge.to} (${edge.toOwner})`;
}

export function analyzeSources(manifest, sources) {
  const rustFiles = [...sources.keys()].sort();
  const { assignment, godFiles } = validateManifest(manifest, rustFiles);
  const { index: moduleIndex, moduleSegmentsByFile } = buildModuleIndex(rustFiles, sources);
  const extracted = new Map(rustFiles.map((path) => [
    path,
    extractModuleSyntax(sources.get(path), moduleSegmentsByFile.get(path) ?? []),
  ]));
  const astItems = loadAstItems(sources);
  const reexportIndex = buildReexportIndex(extracted);
  const resolutionCache = new Map();
  const edges = new Map();
  const occurrenceItems = new Map();
  let unresolvedReferenceCount = 0;
  const unresolvedReferences = [];

  for (const from of rustFiles) {
    const source = sources.get(from);
    assert(typeof source === 'string', `missing source bytes for ${from}`);
    for (const reference of extracted.get(from).references) {
      const resolved = new Set();
      for (const segments of reference.candidates) {
        for (const target of resolveTransitiveModuleReferences(
          segments,
          moduleIndex,
          reexportIndex,
          resolutionCache,
        )) resolved.add(target);
      }
      if (resolved.size === 0) {
        if (reference.ignoreIfUnresolved || reference.candidates.every((segments) => segments.length === 0)) continue;
        unresolvedReferenceCount += 1;
        unresolvedReferences.push({
          from,
          candidates: reference.candidates.map((segments) => segments.join('::')),
        });
        continue;
      }
      for (const to of resolved) {
        if (to === from) continue;
        const edge = {
          from,
          fromOwner: assignment.get(from),
          to,
          toOwner: assignment.get(to),
        };
        const key = edgeKey(edge);
        edges.set(key, edge);
        const carrier = astItems.get(from)
          .filter((item) => item.start <= reference.index && reference.index < item.end)
          .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
        if (carrier) {
          const items = occurrenceItems.get(key) ?? new Map();
          items.set(`${carrier.start}:${carrier.end}`, carrier.fingerprint);
          occurrenceItems.set(key, items);
        }
      }
    }
  }

  const ownItemsByModule = new Map([...astItems].map(([path, items]) => {
    const counts = new Map();
    for (const item of items) counts.set(item.fingerprint, (counts.get(item.fingerprint) ?? 0) + 1);
    return [path, counts];
  }));
  const edgeOccurrences = new Map([...occurrenceItems].map(([key, items]) => {
    const counts = new Map();
    for (const fingerprint of items.values()) {
      counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
    }
    return [key, counts];
  }));

  return {
    assignment,
    edges: [...edges.values()].sort(compareEdges),
    godFiles,
    moduleCount: rustFiles.length,
    ownItemsByModule,
    edgeOccurrences,
    unresolvedReferenceCount,
    unresolvedReferences,
  };
}

function validateAttribution(attribution, label) {
  assert(attribution && typeof attribution === 'object' && !Array.isArray(attribution), `${label} attribution must be an object`);
  assert(/^[0-9a-f]{7,40}$/u.test(attribution.observationRevision ?? ''), `${label} needs an observationRevision`);
  assert(/^issues\/[^/]+\.md$/u.test(attribution.worklist ?? ''), `${label} needs an open issues/ worklist path`);
  assert(typeof attribution.provenance === 'string' && attribution.provenance.trim().length >= 20, `${label} needs substantive provenance`);
  if (attribution.disposition !== undefined) {
    assert(FROZEN_DISPOSITIONS.has(attribution.disposition), `${label} has invalid disposition ${attribution.disposition}`);
    if (attribution.disposition === 'time-bounded-waiver') {
      assert(OWNER_ORDINALS.has(attribution.inversionOwner), `${label} waiver needs a real inversionOwner`);
      assert(attribution.inversionOwner !== 'unassigned', `${label} waiver inversionOwner must be a real owner`);
      assert(/^\d{4}-\d{2}-\d{2}$/u.test(attribution.deadline ?? ''), `${label} waiver needs a YYYY-MM-DD deadline`);
    }
    if (attribution.disposition === 'relocation') {
      assert(
        typeof attribution.predecessorFingerprint === 'string'
          && attribution.predecessorFingerprint.length > 0,
        `${label} relocation needs its exact predecessorFingerprint`,
      );
    }
    return;
  }

  assert(Object.hasOwn(attribution, 'lineage'), `${label} needs an explicit lineage field`);
  assert(Object.hasOwn(attribution, 'obligation'), `${label} needs an explicit obligation field`);
  if (attribution.lineage !== null) {
    assert(attribution.lineage && typeof attribution.lineage === 'object' && !Array.isArray(attribution.lineage), `${label} lineage must be an object or null`);
    assert(LINEAGE_KINDS.has(attribution.lineage.kind), `${label} has invalid lineage kind ${attribution.lineage.kind}`);
    validateUniqueStrings(attribution.lineage.predecessors, `${label}.lineage.predecessors`);
    assert(attribution.lineage.predecessors.length > 0, `${label} lineage needs at least one predecessor`);
  }
  if (attribution.obligation !== null) {
    assert(attribution.obligation && typeof attribution.obligation === 'object' && !Array.isArray(attribution.obligation), `${label} obligation must be an object or null`);
    assert(attribution.obligation.kind === 'time-bounded-waiver', `${label} obligation kind must be time-bounded-waiver`);
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(attribution.obligation.deadline ?? ''), `${label} obligation needs a YYYY-MM-DD deadline`);
    validateUniqueStrings(attribution.obligation.inversionOwners, `${label}.obligation.inversionOwners`);
    assert(attribution.obligation.inversionOwners.length > 0, `${label} obligation needs inversionOwners`);
    for (const owner of attribution.obligation.inversionOwners) {
      assert(OWNER_ORDINALS.has(owner) && owner !== 'unassigned', `${label} obligation has invalid inversion owner ${owner}`);
    }
  }
  if (attribution.origin !== undefined) {
    assert(['freeze', 'analyzer-upgrade'].includes(attribution.origin), `${label} has invalid obligation origin ${attribution.origin}`);
    assert(attribution.obligation === null, `${label} origin is only valid for a null obligation`);
  }
  for (const legacyField of ['deadline', 'inversionOwner', 'predecessorFingerprint']) {
    assert(attribution[legacyField] === undefined, `${label} must not mix legacy ${legacyField} with lineage/obligation`);
  }
}

function normalizedLineage(attribution) {
  if (!attribution) return null;
  if (attribution.disposition === 'relocation') {
    return { kind: 'relocation', predecessors: [attribution.predecessorFingerprint] };
  }
  if (attribution.disposition !== undefined) return null;
  if (attribution.lineage === null) return null;
  return {
    kind: attribution.lineage.kind,
    predecessors: [...attribution.lineage.predecessors].sort(),
  };
}

function normalizedObligation(attribution) {
  if (!attribution) return null;
  if (attribution.disposition === 'time-bounded-waiver') {
    return {
      kind: 'time-bounded-waiver',
      deadline: attribution.deadline,
      inversionOwners: [attribution.inversionOwner],
    };
  }
  if (attribution.disposition !== undefined || attribution.obligation === null) return null;
  return {
    kind: 'time-bounded-waiver',
    deadline: attribution.obligation.deadline,
    inversionOwners: [...attribution.obligation.inversionOwners].sort(),
  };
}

function obligationsEqual(left, right) {
  return deepEqual(left, right);
}

function aggregateObligations(obligations) {
  const waivers = obligations.filter((obligation) => obligation !== null);
  if (waivers.length === 0) return null;
  return {
    kind: 'time-bounded-waiver',
    deadline: waivers.map((obligation) => obligation.deadline).sort()[0],
    inversionOwners: [...new Set(waivers.flatMap((obligation) => obligation.inversionOwners))].sort(),
  };
}

function obligationStrengthens(candidate, predecessor) {
  if (predecessor === null) return candidate !== null;
  if (candidate === null) return false;
  return candidate.deadline <= predecessor.deadline
    && predecessor.inversionOwners.every((owner) => candidate.inversionOwners.includes(owner));
}

function compareObligationDescriptors(left, right) {
  if (left.obligation === null && right.obligation !== null) return 1;
  if (left.obligation !== null && right.obligation === null) return -1;
  if (left.obligation !== null && right.obligation !== null) {
    return left.obligation.deadline.localeCompare(right.obligation.deadline)
      || left.obligation.inversionOwners.join('\0').localeCompare(right.obligation.inversionOwners.join('\0'))
      || left.fingerprint.localeCompare(right.fingerprint);
  }
  return left.fingerprint.localeCompare(right.fingerprint);
}

function validateBaseline(baseline, manifest, godFiles) {
  assert(
    [BASELINE_SCHEMA_V1, BASELINE_SCHEMA].includes(baseline?.schemaVersion),
    `baseline schemaVersion must be ${BASELINE_SCHEMA_V1} or ${BASELINE_SCHEMA}`,
  );
  assert(baseline.manifestSchemaVersion === MANIFEST_SCHEMA, 'baseline manifestSchemaVersion does not match the manifest schema');
  assert(Number.isInteger(baseline.moduleCount) && baseline.moduleCount > 0, 'baseline moduleCount must be non-vacuous');
  assert(Number.isInteger(baseline.edgeCount) && baseline.edgeCount >= 0, 'baseline edgeCount must be non-negative');
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
  const frozen = new Map();
  if (baseline.schemaVersion === BASELINE_SCHEMA_V1) {
    assert(manifest && godFiles, 'v1 baseline admission requires its manifest');
    for (const edge of baseline.edges) {
      if (violationReason(edge, manifest, godFiles) !== null) {
        frozen.set(edgeFingerprint(edge), { fingerprint: edgeFingerprint(edge) });
      }
    }
  } else {
    assert(Array.isArray(baseline.frozenForbiddenEdges), 'v2 baseline frozenForbiddenEdges must be an array');
    assert(
      baseline.frozenForbiddenEdgeCount === baseline.frozenForbiddenEdges.length,
      'baseline frozenForbiddenEdgeCount does not match frozenForbiddenEdges.length',
    );
    const edgesByFingerprint = new Map(baseline.edges.map((edge) => [edgeFingerprint(edge), edge]));
    for (const record of baseline.frozenForbiddenEdges) {
      const fingerprint = record?.fingerprint;
      assert(typeof fingerprint === 'string' && fingerprint.length > 0, 'frozen forbidden edge needs a fingerprint');
      assert(!frozen.has(fingerprint), `duplicate frozen forbidden edge ${fingerprint}`);
      const edge = edgesByFingerprint.get(fingerprint);
      assert(edge, `frozen forbidden edge is absent from baseline graph: ${fingerprint}`);
      assert(manifest && godFiles, 'v2 baseline admission requires its manifest');
      assert(violationReason(edge, manifest, godFiles) !== null, `frozen edge is not forbidden: ${fingerprint}`);
      if (record.attribution !== undefined) validateAttribution(record.attribution, fingerprint);
      frozen.set(fingerprint, record);
    }
    assert(
      JSON.stringify(baseline.frozenForbiddenEdges) === JSON.stringify(
        [...baseline.frozenForbiddenEdges].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint)),
      ),
      'baseline frozenForbiddenEdges must be sorted',
    );
  }
  return { edgeKeys: keys, frozen };
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

function summarizeBaselineDelta(manifest, analysis, baseline) {
  const validated = validateBaseline(baseline, manifest, analysis.godFiles);
  const newEdges = analysis.edges.filter((edge) => !validated.edgeKeys.has(edgeKey(edge)));
  const currentKeys = new Set(analysis.edges.map(edgeKey));
  const staleBaselineEdgeCount = [...validated.edgeKeys].filter((key) => !currentKeys.has(key)).length;
  return { newEdges, staleBaselineEdgeCount };
}

function loadRepositorySources() {
  const rustFiles = globSync('src/**/*.rs', { cwd: ROOT }).sort();
  return new Map(rustFiles.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]));
}

function loadRepositoryIssues() {
  const issuePaths = globSync('issues/*.md', { cwd: ROOT }).sort();
  return new Map(issuePaths.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]));
}

function loadRepositoryLlps() {
  const paths = globSync('llp/*.md', { cwd: ROOT }).sort();
  return new Map(paths.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]));
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function loadAstItems(sources) {
  const missing = new Map([...sources]
    .filter(([, source]) => !astItemCache.has(source)));
  if (missing.size > 0) {
    if (!existsSync(AST_HELPER_BINARY)) {
      const build = (offline) => execFileSync('cargo', [
        'build', '--release', ...(offline ? ['--offline'] : []), '--locked',
        '--manifest-path', AST_HELPER_MANIFEST,
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      try {
        build(true);
      } catch {
        // A fresh machine may not have the pinned crates in Cargo's local
        // cache yet. Keep the usual network-capable Cargo fallback.
        build(false);
      }
    }
    let parsed;
    try {
      parsed = JSON.parse(execFileSync(AST_HELPER_BINARY, [], {
        cwd: ROOT,
        encoding: 'utf8',
        input: JSON.stringify(Object.fromEntries(missing)),
        maxBuffer: 256 * 1024 * 1024,
      }));
    } catch (error) {
      throw new Error(`pinned Rust item parser failed closed: ${error.stderr?.trim() || error.message}`);
    }
    assert(parsed?.astVersion === AST_VERSION, `Rust item parser version must be ${AST_VERSION}`);
    for (const [path, source] of missing) {
      const items = parsed.files?.[path];
      assert(Array.isArray(items), `Rust item parser omitted ${path}`);
      for (const item of items) {
        assert(Number.isInteger(item?.start) && Number.isInteger(item?.end), `${path} item span is invalid`);
        assert(item.start < item.end && item.end <= source.length, `${path} item span is out of bounds`);
        assert(/^[0-9a-f]{64}$/u.test(item.fingerprint ?? ''), `${path} item fingerprint is invalid`);
      }
      astItemCache.set(source, items);
    }
  }
  return new Map([...sources].map(([path, source]) => [path, astItemCache.get(source)]));
}

function loadRevisionSnapshot(revision) {
  const resolvedRevision = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
  const paths = git(['ls-tree', '-r', '--name-only', resolvedRevision]).trim().split('\n').filter(Boolean);
  const read = (path) => git(['show', `${resolvedRevision}:${path}`]);
  const rustFiles = paths.filter((path) => /^src\/(?:[^/]+\/)*[^/]+\.rs$/u.test(path)).sort();
  const issuePaths = paths.filter((path) => /^issues\/[^/]+\.md$/u.test(path)).sort();
  const llpPaths = paths.filter((path) => /^llp\/[^/]+\.md$/u.test(path)).sort();
  const manifest = JSON.parse(read('ownership.manifest.json'));
  const baseline = JSON.parse(read('ownership.baseline.json'));
  const sources = new Map(rustFiles.map((path) => [path, read(path)]));
  const issues = new Map(issuePaths.map((path) => [path, read(path)]));
  const llps = new Map(llpPaths.map((path) => [path, read(path)]));
  // A predecessor may itself be the red being fixed forward. Treat modules
  // already missing there as historical residue so the pushed tree can remove
  // them or explicitly park them in unassigned. A module new in the pushed
  // tree is absent from this patched set and remains blocked by shrink-only.
  const assigned = new Set(Object.values(manifest.modulesByOwner).flat());
  const missing = rustFiles.filter((path) => !assigned.has(path));
  manifest.modulesByOwner.unassigned = [
    ...manifest.modulesByOwner.unassigned,
    ...missing,
  ].sort();
  const analysis = analyzeSources(manifest, sources);
  return { analysis, baseline, issues, llps, manifest, revision: resolvedRevision };
}

function normalizeIssueText(text) {
  return text.replace(/\s+/gu, ' ').trim();
}

export function parseFrozenEdgeRecords(issueSources) {
  const records = new Map();
  const pattern = /<!--\s*module-ownership-frozen-edge:\s*(\{[^\r\n]*\})\s*-->/gu;
  for (const [path, source] of issueSources) {
    for (const match of source.matchAll(pattern)) {
      let record;
      try {
        record = JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`${path} has malformed ${FROZEN_EDGE_MARKER} JSON: ${error.message}`);
      }
      const fingerprint = record?.fingerprint;
      assert(typeof fingerprint === 'string' && fingerprint.length > 0, `${path} frozen-edge record needs a fingerprint`);
      assert(!records.has(fingerprint), `duplicate frozen-edge worklist record for ${fingerprint}`);
      const attribution = record.disposition !== undefined
        ? {
          disposition: record.disposition,
          observationRevision: record.observationRevision,
          worklist: path,
          provenance: record.provenance,
          ...(record.inversionOwner === undefined ? {} : { inversionOwner: record.inversionOwner }),
          ...(record.deadline === undefined ? {} : { deadline: record.deadline }),
          ...(record.predecessorFingerprint === undefined
            ? {}
            : { predecessorFingerprint: record.predecessorFingerprint }),
        }
        : {
          lineage: record.lineage,
          obligation: record.obligation,
          observationRevision: record.observationRevision,
          worklist: path,
          provenance: record.provenance,
          ...(record.origin === undefined ? {} : { origin: record.origin }),
        };
      validateAttribution(attribution, `${path}: ${fingerprint}`);
      records.set(fingerprint, { fingerprint, attribution });
    }
  }
  return records;
}

export function parseAmendmentRecords(issueSources) {
  const amendments = [];
  const pattern = /<!--\s*module-ownership-amendment:\s*(\{[^\r\n]*\})\s*-->/gu;
  for (const [path, source] of issueSources) {
    for (const match of source.matchAll(pattern)) {
      let amendment;
      try {
        amendment = JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`${path} has malformed ${AMENDMENT_MARKER} JSON: ${error.message}`);
      }
      assert(typeof amendment?.priorFingerprint === 'string' && amendment.priorFingerprint.length > 0, `${path} amendment needs priorFingerprint`);
      assert(typeof amendment?.newFingerprint === 'string' && amendment.newFingerprint.length > 0, `${path} amendment needs newFingerprint`);
      assert(AMENDMENT_KINDS.has(amendment.kind), `${path} amendment has invalid kind ${amendment.kind}`);
      assert(Object.hasOwn(amendment, 'priorFields') && Object.hasOwn(amendment, 'newFields'), `${path} amendment must pin priorFields and newFields`);
      assert(/^llp\/[^/]+\.md$/u.test(amendment.authorization?.record ?? ''), `${path} amendment authorization must name an llp/ record`);
      assert(typeof amendment.authorization?.clauseId === 'string' && amendment.authorization.clauseId.length > 0, `${path} amendment authorization needs clauseId`);
      assert(typeof amendment.provenance === 'string' && amendment.provenance.trim().length >= 20, `${path} amendment needs substantive provenance`);
      amendments.push({ ...amendment, worklist: path });
    }
  }
  return amendments;
}

export function parseAmendmentGrants(llpSources) {
  const grants = new Map();
  const pattern = /<!--\s*module-ownership-amendment-grant:\s*(\{[^\r\n]*\})\s*-->/gu;
  for (const [path, source] of llpSources ?? []) {
    for (const match of source.matchAll(pattern)) {
      let grant;
      try {
        grant = JSON.parse(match[1]);
      } catch (error) {
        throw new Error(`${path} has malformed ${AMENDMENT_GRANT_MARKER} JSON: ${error.message}`);
      }
      assert(typeof grant?.grantId === 'string' && grant.grantId.length > 0, `${path} amendment grant needs grantId`);
      assert(!grants.has(grant.grantId), `duplicate amendment grantId ${grant.grantId} on predecessor snapshot`);
      assert(grant.scope && typeof grant.scope === 'object' && !Array.isArray(grant.scope), `${path} grant ${grant.grantId} needs scope`);
      const scopeKeys = Object.keys(grant.scope);
      assert(scopeKeys.length === 1 && ['fingerprint', 'target'].includes(scopeKeys[0]), `${path} grant ${grant.grantId} scope must pin one fingerprint or target`);
      assert(typeof grant.scope[scopeKeys[0]] === 'string' && grant.scope[scopeKeys[0]].length > 0, `${path} grant ${grant.grantId} scope is empty`);
      assert(AMENDMENT_KINDS.has(grant.kind), `${path} grant ${grant.grantId} has invalid kind ${grant.kind}`);
      assert(AMENDMENT_DIRECTIONS.has(grant.direction), `${path} grant ${grant.grantId} needs an explicit direction`);
      assert(Object.hasOwn(grant, 'priorFields') && Object.hasOwn(grant, 'newFields'), `${path} grant ${grant.grantId} must pin priorFields/newFields or explicit null`);
      if (grant.kind === 'ownership-correction') {
        assert(grant.priorFields !== null && grant.newFields !== null, `${path} ownership-correction grant ${grant.grantId} must pin non-null fields`);
      }
      grants.set(grant.grantId, { ...grant, record: path });
    }
  }
  return grants;
}

function amendmentDirection(amendment) {
  if (amendment.kind === 'ownership-correction') return 'weaken';
  if (amendment.kind === 'lineage-change') return 'any';
  const prior = amendment.priorFields?.obligation ?? amendment.priorFields;
  const next = amendment.newFields?.obligation ?? amendment.newFields;
  return obligationStrengthens(next, prior) ? 'strengthen' : 'weaken';
}

function matchingAmendment(current, predecessor, {
  kind,
  newFingerprint,
  newFields,
  priorFingerprint,
  priorFields,
  target,
}) {
  const amendments = parseAmendmentRecords(current.issues);
  const grants = parseAmendmentGrants(predecessor.llps ?? new Map());
  const amendment = amendments.find((candidate) => (
    candidate.kind === kind
      && candidate.priorFingerprint === priorFingerprint
      && candidate.newFingerprint === newFingerprint
      && deepEqual(candidate.priorFields, priorFields)
      && deepEqual(candidate.newFields, newFields)
  ));
  if (!amendment) return null;
  const grant = grants.get(amendment.authorization.clauseId);
  assert(grant, `${amendment.worklist} amendment grant ${amendment.authorization.clauseId} is absent from predecessor ${predecessor.revision}`);
  assert(grant.record === amendment.authorization.record, `${amendment.worklist} amendment grant record does not match predecessor bytes`);
  assert(grant.kind === amendment.kind, `${amendment.worklist} amendment kind does not match grant ${grant.grantId}`);
  const scopeMatches = grant.scope.fingerprint === priorFingerprint
    || grant.scope.fingerprint === newFingerprint
    || grant.scope.target === target;
  assert(scopeMatches, `${amendment.worklist} amendment scope does not match ${priorFingerprint}`);
  const direction = amendmentDirection(amendment);
  assert(grant.direction === 'any' || grant.direction === direction, `${amendment.worklist} amendment direction ${direction} is not granted`);
  assert(grant.priorFields === null || deepEqual(grant.priorFields, amendment.priorFields), `${amendment.worklist} amendment priorFields do not match grant ${grant.grantId}`);
  assert(grant.newFields === null || deepEqual(grant.newFields, amendment.newFields), `${amendment.worklist} amendment newFields do not match grant ${grant.grantId}`);
  return amendment;
}

function forbiddenEdges(manifest, analysis) {
  return analysis.edges
    .map((edge) => ({ ...edge, reason: violationReason(edge, manifest, analysis.godFiles) }))
    .filter((edge) => edge.reason !== null);
}

function waiverFingerprints(records) {
  return new Set([...records.values()]
    .filter((record) => normalizedObligation(record.attribution) !== null)
    .map((record) => record.fingerprint));
}

function expiredWaiverFingerprints(records, today) {
  return [...records.values()]
    .filter((record) => normalizedObligation(record.attribution)?.deadline < today)
    .map((record) => record.fingerprint)
    .sort();
}

export function formatExpiredWaiverEscalation(expiredWaivers) {
  if (expiredWaivers.length === 0) return '';
  const noun = expiredWaivers.length === 1 ? 'waiver' : 'waivers';
  return `; ${expiredWaivers.length} expired ${noun} (escalate)`;
}

export function outstandingFingerprints(snapshot) {
  const baseline = validateBaseline(
    snapshot.baseline,
    snapshot.manifest,
    snapshot.analysis.godFiles,
  );
  const worklistRecords = parseFrozenEdgeRecords(snapshot.issues);
  for (const frozen of baseline.frozen.values()) {
    if (!frozen.attribution) continue;
    assert(
      attributedRecordMatches(frozen, worklistRecords.get(frozen.fingerprint)),
      `attributed frozen edge needs its matching open worklist record: ${frozen.fingerprint}`,
    );
  }
  const waivers = waiverFingerprints(worklistRecords);
  return new Set(forbiddenEdges(snapshot.manifest, snapshot.analysis)
    .map(edgeFingerprint)
    .filter((fingerprint) => !baseline.frozen.has(fingerprint) && !waivers.has(fingerprint)));
}

function attributedRecordMatches(candidate, worklistRecord) {
  return JSON.stringify(candidate) === JSON.stringify(worklistRecord);
}

function multisetContains(superset, subset) {
  if (!subset || subset.size === 0) return false;
  for (const [fingerprint, count] of subset) {
    if ((superset?.get(fingerprint) ?? 0) < count) return false;
  }
  return true;
}

function multisetsIntersect(left, right) {
  for (const fingerprint of left?.keys() ?? []) {
    if ((right?.get(fingerprint) ?? 0) > 0) return true;
  }
  return false;
}

function admissionRecord(snapshot, validatedBaseline, fingerprint) {
  const frozen = validatedBaseline.frozen.get(fingerprint);
  if (frozen) return frozen;
  const worklist = parseFrozenEdgeRecords(snapshot.issues).get(fingerprint);
  return normalizedObligation(worklist?.attribution) === null ? null : worklist;
}

function obligationDescriptors(snapshot, validatedBaseline) {
  const forbidden = new Map(forbiddenEdges(snapshot.manifest, snapshot.analysis)
    .map((edge) => [edgeFingerprint(edge), edge]));
  const descriptors = [];
  const seen = new Set();
  const add = (record) => {
    const edge = forbidden.get(record.fingerprint);
    if (!edge || seen.has(record.fingerprint)) return;
    seen.add(record.fingerprint);
    descriptors.push({
      edge,
      fingerprint: record.fingerprint,
      obligation: normalizedObligation(record.attribution),
      record,
    });
  };
  for (const record of validatedBaseline.frozen.values()) add(record);
  for (const record of parseFrozenEdgeRecords(snapshot.issues).values()) {
    if (normalizedObligation(record.attribution) !== null) add(record);
  }
  return descriptors;
}

function currentForbiddenByTarget(snapshot) {
  const byTarget = new Map();
  for (const edge of forbiddenEdges(snapshot.manifest, snapshot.analysis)) {
    const bucket = byTarget.get(edge.to) ?? [];
    bucket.push(edge);
    byTarget.set(edge.to, bucket);
  }
  return byTarget;
}

function ownSuccessors(predecessorOwn, current) {
  if (!predecessorOwn || predecessorOwn.size === 0) return [];
  return [...current.analysis.ownItemsByModule]
    .filter(([, own]) => multisetContains(own, predecessorOwn))
    .map(([path]) => path)
    .sort();
}

function resolveHostIdentities(predecessor, current, descriptors) {
  const hosts = new Map();
  for (const descriptor of descriptors) {
    const path = descriptor.edge.from;
    if (hosts.has(path)) continue;
    const predecessorOwn = predecessor.analysis.ownItemsByModule.get(path) ?? new Map();
    const successors = ownSuccessors(predecessorOwn, current);
    const presentOwn = current.analysis.ownItemsByModule.get(path);
    const presentContentMatch = multisetContains(presentOwn, predecessorOwn);
    const resolved = presentContentMatch
      ? path
      : (successors.length === 1 ? successors[0] : null);
    hosts.set(path, {
      path,
      predecessorOwn,
      presentContentMatch,
      resolved,
      successors,
    });
  }
  return hosts;
}

function computedTargetIdentity(predecessor, current, target, descriptors, directCurrentEdges) {
  if (directCurrentEdges.length > 0) {
    return {
      candidates: [target],
      hosts: resolveHostIdentities(predecessor, current, descriptors),
      leftovers: new Set(),
      target,
      verdict: 'carry',
    };
  }
  // LLP 0273 §3.6 normative order: S/SH from own-items, H, L, T, then LH.
  const predecessorOwn = predecessor.analysis.ownItemsByModule.get(target) ?? new Map();
  const candidates = ownSuccessors(predecessorOwn, current);
  const hosts = resolveHostIdentities(predecessor, current, descriptors);
  const leftovers = new Set();
  for (const host of hosts.values()) {
    if (!host.resolved) continue;
    const previousTargets = new Set(predecessor.analysis.edges
      .filter((edge) => edge.from === host.resolved)
      .map((edge) => edge.to));
    for (const edge of current.analysis.edges.filter((candidate) => candidate.from === host.resolved)) {
      const targetOwn = current.analysis.ownItemsByModule.get(edge.to) ?? new Map();
      if (!previousTargets.has(edge.to) || multisetsIntersect(targetOwn, predecessorOwn)) {
        leftovers.add(edge.to);
      }
    }
  }
  if (candidates.length === 1 && [...leftovers].every((path) => path === candidates[0])) {
    return { candidates, hosts, leftovers, target: candidates[0], verdict: 'carry' };
  }
  if (candidates.length === 0 && leftovers.size === 0) {
    return { candidates, hosts, leftovers, target: null, verdict: 'genuine-removal' };
  }
  return { candidates, hosts, leftovers, target: null, verdict: 'block' };
}

function currentOccurrenceFingerprints(analysis, target, excludedFingerprint = null) {
  const fingerprints = new Set();
  if (target === null) return fingerprints;
  for (const edge of analysis.edges.filter((candidate) => candidate.to === target)) {
    if (edgeFingerprint(edge) === excludedFingerprint) continue;
    for (const fingerprint of analysis.edgeOccurrences.get(edgeKey(edge))?.keys() ?? []) {
      fingerprints.add(fingerprint);
    }
  }
  return fingerprints;
}

function predecessorCarrierFingerprints(predecessor, descriptor) {
  return new Set(predecessor.analysis.edgeOccurrences.get(edgeKey(descriptor.edge))?.keys() ?? []);
}

function dischargeState(predecessor, current, identity, descriptors) {
  const promoted = new Set(descriptors
    .filter((descriptor) => {
      const currentCarriers = currentOccurrenceFingerprints(
        current.analysis,
        identity.target,
        descriptor.fingerprint,
      );
      return [...predecessorCarrierFingerprints(predecessor, descriptor)]
        .some((fingerprint) => currentCarriers.has(fingerprint));
    })
    .map((descriptor) => descriptor.fingerprint));
  const refusals = [];
  const predecessorSources = new Set(descriptors.map((descriptor) => descriptor.edge.from));
  for (const host of identity.hosts.values()) {
    const liveToTarget = identity.target === null
      ? []
      : current.analysis.edges.filter((edge) => (
        edge.to === identity.target
          && violationReason(edge, current.manifest, current.analysis.godFiles) === null
      ));
    const leftovers = liveToTarget.filter((edge) => (
      !predecessorSources.has(edge.from)
        || multisetsIntersect(
          current.analysis.ownItemsByModule.get(edge.from) ?? new Map(),
          host.predecessorOwn,
        )
    ));
    const resolvedSet = new Set(host.resolved ? [host.resolved] : []);
    const outside = leftovers.filter((edge) => !resolvedSet.has(edge.from));
    const direct = host.resolved === null || identity.target === null
      ? []
      : liveToTarget.filter((edge) => edge.from === host.resolved);
    const unresolved = current.analysis.unresolvedReferences
      .filter((reference) => reference.from === host.resolved || reference.from === host.path);
    if (outside.length > 0 || (host.resolved === null && leftovers.length > 0)) {
      refusals.push({ host, kind: 'host-leftover', edges: outside.length > 0 ? outside : leftovers });
    }
    if (direct.length > 0) refusals.push({ host, kind: 'occurrence', edges: direct });
    if (unresolved.length > 0) refusals.push({ host, kind: 'unresolved', edges: [] });
  }

  const unauthorized = [];
  const authorizedCorrections = new Set();
  for (const refusal of refusals) {
    if (refusal.kind === 'unresolved') {
      unauthorized.push(refusal);
      continue;
    }
    for (const descriptor of descriptors) {
      const related = refusal.edges.find((edge) => (
        edge.from === refusal.host.resolved
          || multisetsIntersect(
            current.analysis.ownItemsByModule.get(edge.from) ?? new Map(),
            refusal.host.predecessorOwn,
          )
      ));
      if (!related) continue;
      const priorFields = { obligation: descriptor.obligation };
      const newFields = { obligation: null };
      const amendment = matchingAmendment(current, predecessor, {
        kind: 'ownership-correction',
        priorFingerprint: descriptor.fingerprint,
        newFingerprint: edgeFingerprint(related),
        priorFields,
        newFields,
        target: identity.target ?? descriptor.edge.to,
      });
      if (!amendment) unauthorized.push({ ...refusal, descriptor });
      else authorizedCorrections.add(descriptor.fingerprint);
    }
  }
  for (const fingerprint of authorizedCorrections) promoted.delete(fingerprint);
  return { promoted, refused: unauthorized.length > 0, refusals: unauthorized };
}

function recordWithoutObligation(record) {
  if (!record?.attribution) return record;
  const attribution = { ...record.attribution };
  if (attribution.disposition === 'time-bounded-waiver') {
    delete attribution.deadline;
    delete attribution.inversionOwner;
  } else {
    delete attribution.obligation;
  }
  return { ...record, attribution };
}

function validateIntersectionRecord(current, predecessor, fingerprint, currentRecord, predecessorRecord) {
  if (deepEqual(currentRecord, predecessorRecord)) return;
  const priorObligation = normalizedObligation(predecessorRecord.attribution);
  const newObligation = normalizedObligation(currentRecord.attribution);
  const strengthenOnly = deepEqual(
    recordWithoutObligation(currentRecord),
    recordWithoutObligation(predecessorRecord),
  ) && obligationStrengthens(newObligation, priorObligation);
  if (strengthenOnly) return;
  const lineageChanged = !deepEqual(
    normalizedLineage(currentRecord.attribution),
    normalizedLineage(predecessorRecord.attribution),
  );
  const kind = lineageChanged ? 'lineage-change' : 'deadline-change';
  const priorFields = lineageChanged
    ? { lineage: normalizedLineage(predecessorRecord.attribution) }
    : { obligation: priorObligation };
  const newFields = lineageChanged
    ? { lineage: normalizedLineage(currentRecord.attribution) }
    : { obligation: newObligation };
  const amendment = matchingAmendment(current, predecessor, {
    kind,
    priorFingerprint: fingerprint,
    newFingerprint: fingerprint,
    priorFields,
    newFields,
    target: current.analysis.edges.find((edge) => edgeFingerprint(edge) === fingerprint)?.to,
  });
  assert(amendment, `retained frozen-edge record changed without a predecessor-authorized ${kind} amendment: ${fingerprint}`);
}

function enforceConservation(current, predecessor, currentBaseline, predecessorBaseline, { today }) {
  const descriptors = obligationDescriptors(predecessor, predecessorBaseline);
  const descriptorFingerprints = new Set(descriptors.map((descriptor) => descriptor.fingerprint));
  const inheritedUnadmitted = new Set(forbiddenEdges(predecessor.manifest, predecessor.analysis)
    .map(edgeFingerprint)
    .filter((fingerprint) => !descriptorFingerprints.has(fingerprint)));
  const currentByTarget = currentForbiddenByTarget(current);
  const identities = new Map();
  for (const target of new Set(descriptors.map((descriptor) => descriptor.edge.to))) {
    const targetDescriptors = descriptors.filter((descriptor) => descriptor.edge.to === target);
    const identity = computedTargetIdentity(
      predecessor,
      current,
      target,
      targetDescriptors,
      currentByTarget.get(target) ?? [],
    );
    assert(
      identity.verdict !== 'block',
      `ambiguous ownership target removal for ${target}; candidates=[${identity.candidates.join(', ')}], leftovers=[${[...identity.leftovers].join(', ')}]`,
    );
    for (const descriptor of targetDescriptors) identities.set(descriptor.fingerprint, identity);
  }

  const groups = new Map();
  for (const descriptor of descriptors) {
    const identity = identities.get(descriptor.fingerprint);
    const key = identity.target === null
      ? `removed\0${descriptor.edge.to}`
      : `target\0${identity.target}`;
    const group = groups.get(key) ?? { descriptors: [], identity, target: identity.target };
    group.descriptors.push(descriptor);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const ordered = [...group.descriptors].sort(compareObligationDescriptors);
    // The pre-0273 ticketed-red lane has no disposition to conserve. Preserve
    // it unchanged while deriving every actual frozen/waived obligation.
    const currentEdges = group.target === null
      ? []
      : (currentByTarget.get(group.target) ?? [])
        .filter((edge) => !inheritedUnadmitted.has(edgeFingerprint(edge)));
    const k = currentEdges.length;
    const m = ordered.length;
    const required = new Map(ordered.slice(0, Math.min(k, m))
      .map((descriptor) => [descriptor.fingerprint, descriptor]));
    const departing = ordered.slice(Math.min(k, m));
    if (departing.length > 0) {
      const disposition = dischargeState(predecessor, current, group.identity, departing);
      for (const descriptor of departing) {
        if (disposition.promoted.has(descriptor.fingerprint)) required.set(descriptor.fingerprint, descriptor);
      }
      if (disposition.refused && disposition.promoted.size === 0) {
        throw new Error(`ownership obligation discharge refused for ${group.target ?? group.descriptors[0].edge.to}`);
      }
      assert(
        k > 0 || disposition.promoted.size === 0,
        `byte-identical carrier promoted an obligation with no forbidden edge available to carry it: ${group.target ?? group.descriptors[0].edge.to}`,
      );
    }

    const records = currentEdges.map((edge) => ({
      edge,
      record: admissionRecord(current, currentBaseline, edgeFingerprint(edge)),
      used: false,
    }));
    const remaining = new Map(required);
    for (const entry of records) {
      const predecessors = normalizedLineage(entry.record?.attribution)?.predecessors ?? [];
      const selected = predecessors.map((fingerprint) => remaining.get(fingerprint)).filter(Boolean);
      if (selected.length < 2) continue;
      const expected = aggregateObligations(selected.map((descriptor) => descriptor.obligation));
      if (!obligationsEqual(normalizedObligation(entry.record.attribution), expected)) continue;
      for (const descriptor of selected) remaining.delete(descriptor.fingerprint);
      entry.used = true;
    }
    for (const descriptor of remaining.values()) {
      let entry = records.find((candidate) => (
        !candidate.used
          && candidate.record
          && obligationsEqual(normalizedObligation(candidate.record.attribution), descriptor.obligation)
      ));
      if (!entry) {
        entry = records.find((candidate) => {
          if (candidate.used || !candidate.record) return false;
          const newObligation = normalizedObligation(candidate.record.attribution);
          return matchingAmendment(current, predecessor, {
            kind: 'deadline-change',
            priorFingerprint: descriptor.fingerprint,
            newFingerprint: edgeFingerprint(candidate.edge),
            priorFields: { obligation: descriptor.obligation },
            newFields: { obligation: newObligation },
            target: group.target,
          }) !== null;
        });
      }
      assert(entry, `strict predecessor obligation is not carried verbatim on a distinct current edge to ${group.target}: ${descriptor.fingerprint}`);
      entry.used = true;
      remaining.delete(descriptor.fingerprint);
    }
    assert(remaining.size === 0, `not every required obligation was conserved for ${group.target}`);

    const fresh = records.filter((entry) => !entry.used);
    assert(fresh.length === Math.max(0, k - m), `current edge attribution count is not conserved for ${group.target}`);
    for (const entry of fresh) {
      const obligation = normalizedObligation(entry.record?.attribution);
      assert(obligation !== null, `genuinely new forbidden edge needs its own fresh time-bounded waiver: ${edgeFingerprint(entry.edge)}`);
      assert(obligation.deadline >= today, `fresh waiver expired ${obligation.deadline}: ${edgeFingerprint(entry.edge)}`);
      const worklist = parseFrozenEdgeRecords(current.issues).get(edgeFingerprint(entry.edge));
      assert(worklist && attributedRecordMatches(entry.record, worklist), `fresh attribution must match its current reviewed worklist: ${edgeFingerprint(entry.edge)}`);
      assert(
        !ordered.some((descriptor) => obligationsEqual(descriptor.obligation, obligation)),
        `fresh attribution must not replay a predecessor obligation clock: ${edgeFingerprint(entry.edge)}`,
      );
    }
  }
}

export function enforceMonotonicBaseline(
  current,
  predecessor,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  const currentBaseline = validateBaseline(
    current.baseline,
    current.manifest,
    current.analysis.godFiles,
  );
  const predecessorBaseline = validateBaseline(
    predecessor.baseline,
    predecessor.manifest,
    predecessor.analysis.godFiles,
  );
  parseAmendmentGrants(predecessor.llps ?? new Map());
  const worklistRecords = parseFrozenEdgeRecords(current.issues);
  const growth = [...currentBaseline.frozen.keys()]
    .filter((fingerprint) => !predecessorBaseline.frozen.has(fingerprint))
    .sort();
  const removed = [...predecessorBaseline.frozen.keys()]
    .filter((fingerprint) => !currentBaseline.frozen.has(fingerprint));
  const intersection = [...currentBaseline.frozen.keys()]
    .filter((fingerprint) => predecessorBaseline.frozen.has(fingerprint))
    .sort();
  const predecessorForbidden = new Set(forbiddenEdges(
    predecessor.manifest,
    predecessor.analysis,
  ).map(edgeFingerprint));

  for (const fingerprint of growth) {
    const frozen = currentBaseline.frozen.get(fingerprint);
    const worklist = worklistRecords.get(fingerprint);
    assert(worklist, `silent forbidden-edge baseline growth; add an explicit reviewed worklist record: ${fingerprint}`);
    assert(frozen.attribution, `new frozen edge lacks retained attribution: ${fingerprint}`);
    assert(
      attributedRecordMatches(frozen, worklist),
      `baseline attribution does not match ${worklist.attribution.worklist}: ${fingerprint}`,
    );
    const obligation = normalizedObligation(frozen.attribution);
    if (obligation !== null) {
      assert(
        obligation.deadline >= today,
        `${worklist.attribution.worklist} waiver expired ${obligation.deadline}: ${fingerprint}`,
      );
    }
    const analyzerUpgrade = frozen.attribution.disposition === 'analyzer-upgrade'
      || frozen.attribution.origin === 'analyzer-upgrade';
    if (analyzerUpgrade) {
      assert(
        predecessorForbidden.has(fingerprint),
        `analyzer-upgrade record does not name an edge present at predecessor ${predecessor.revision}: ${fingerprint}`,
      );
    }
    const lineage = normalizedLineage(frozen.attribution);
    if (lineage !== null) {
      for (const priorFingerprint of lineage.predecessors) {
        assert(predecessorBaseline.frozen.has(priorFingerprint), `lineage names a predecessor without a frozen obligation: ${priorFingerprint}`);
      }
    }
  }
  for (const fingerprint of intersection) {
    validateIntersectionRecord(
      current,
      predecessor,
      fingerprint,
      currentBaseline.frozen.get(fingerprint),
      predecessorBaseline.frozen.get(fingerprint),
    );
  }
  enforceConservation(current, predecessor, currentBaseline, predecessorBaseline, { today });
  return { growth, intersection, removed };
}

function enforceUnassignedShrinkOnly(current, predecessor) {
  const previous = new Set(predecessor.manifest.modulesByOwner.unassigned);
  const additions = current.manifest.modulesByOwner.unassigned.filter((path) => !previous.has(path));
  const permittedOwners = Object.keys(current.manifest.owners)
    .filter((owner) => owner !== 'unassigned');
  assert(
    additions.length === 0,
    `legacy unassigned bucket is shrink-only; assign new modules to a real owner: ${additions.join(', ')}; permitted owners: ${permittedOwners.join(', ')}`,
  );
}

function trackingTicketsFor(fingerprints, issueSources) {
  if (fingerprints.length === 0) return [];
  const covered = new Set();
  const tickets = [];
  for (const [path, source] of issueSources) {
    if (!/^\*\*Status:\*\*\s*Open\s*$/imu.test(source)) continue;
    const normalized = normalizeIssueText(source);
    if (!/\b(?:(?:re-)?observed(?:\s+revision)?\s+at|observation\s+revision(?:\s+at)?)\s*:?\s+`[0-9a-f]{7,40}`/iu.test(normalized)) continue;
    const newlyCovered = fingerprints.filter((fingerprint) => (
      !covered.has(fingerprint) && normalized.includes(fingerprint)
    ));
    if (newlyCovered.length === 0) continue;
    tickets.push(path);
    for (const fingerprint of newlyCovered) covered.add(fingerprint);
  }
  return covered.size === fingerprints.length ? tickets : null;
}

export function enforceSnapshotProtocol(
  current,
  predecessors,
  { today = new Date().toISOString().slice(0, 10) } = {},
) {
  assert(predecessors.length > 0, 'ownership protocol requires at least one predecessor revision');
  const currentWorklistRecords = parseFrozenEdgeRecords(current.issues);
  const expiredWaivers = expiredWaiverFingerprints(currentWorklistRecords, today);
  const currentOutstanding = outstandingFingerprints(current);
  const reports = [];
  for (const predecessor of predecessors) {
    enforceUnassignedShrinkOnly(current, predecessor);
    const baseline = enforceMonotonicBaseline(current, predecessor, { today });
    const predecessorOutstanding = outstandingFingerprints(predecessor);
    const introduced = [...currentOutstanding]
      .filter((fingerprint) => !predecessorOutstanding.has(fingerprint))
      .sort();
    assert(
      introduced.length === 0,
      `introduced forbidden module edges versus ${predecessor.revision}:\n- ${introduced.join('\n- ')}`,
    );
    reports.push({ baseline, introduced, predecessor, predecessorOutstanding });
  }
  const inherited = [...currentOutstanding].sort();
  const tickets = trackingTicketsFor(inherited, current.issues);
  assert(
    inherited.length === 0 || tickets,
    `inherited forbidden module edges need open issues/ tickets jointly naming every fingerprint and an explicit observed-at revision:\n- ${inherited.join('\n- ')}`,
  );
  return {
    expiredWaivers,
    inherited,
    reports,
    ticket: tickets?.join(', ') || null,
    tickets: tickets ?? [],
  };
}

export function buildBaselineDocument(analysis, manifest, predecessor, issueSources, llps = new Map()) {
  const previous = validateBaseline(
    predecessor.baseline,
    predecessor.manifest,
    predecessor.analysis.godFiles,
  );
  const worklistRecords = parseFrozenEdgeRecords(issueSources);
  const currentForbidden = forbiddenEdges(manifest, analysis);
  const frozenForbiddenEdges = [];
  for (const edge of currentForbidden) {
    const fingerprint = edgeFingerprint(edge);
    const attributed = worklistRecords.get(fingerprint);
    const retained = previous.frozen.get(fingerprint);
    if (retained) {
      let selected = retained;
      if (attributed && !deepEqual(attributed, retained)) {
        const priorObligation = normalizedObligation(retained.attribution);
        const newObligation = normalizedObligation(attributed.attribution);
        const strengthens = deepEqual(
          recordWithoutObligation(attributed),
          recordWithoutObligation(retained),
        ) && obligationStrengthens(newObligation, priorObligation);
        const current = {
          analysis,
          baseline: predecessor.baseline,
          issues: issueSources,
          llps,
          manifest,
          revision: 'working-tree',
        };
        const lineageChanged = !deepEqual(
          normalizedLineage(attributed.attribution),
          normalizedLineage(retained.attribution),
        );
        const kind = lineageChanged ? 'lineage-change' : 'deadline-change';
        const priorFields = lineageChanged
          ? { lineage: normalizedLineage(retained.attribution) }
          : { obligation: priorObligation };
        const newFields = lineageChanged
          ? { lineage: normalizedLineage(attributed.attribution) }
          : { obligation: newObligation };
        const amendmentFiled = parseAmendmentRecords(issueSources).some((amendment) => (
          amendment.kind === kind
            && amendment.priorFingerprint === fingerprint
            && amendment.newFingerprint === fingerprint
            && deepEqual(amendment.priorFields, priorFields)
            && deepEqual(amendment.newFields, newFields)
        ));
        if (strengthens || amendmentFiled) {
          validateIntersectionRecord(current, predecessor, fingerprint, attributed, retained);
          selected = attributed;
        }
      }
      frozenForbiddenEdges.push(selected);
      continue;
    }
    if (attributed) {
      frozenForbiddenEdges.push(attributed);
      continue;
    }
  }
  frozenForbiddenEdges.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  return {
    schemaVersion: BASELINE_SCHEMA,
    manifestSchemaVersion: MANIFEST_SCHEMA,
    moduleCount: analysis.moduleCount,
    edgeCount: analysis.edges.length,
    edges: analysis.edges,
    frozenForbiddenEdgeCount: frozenForbiddenEdges.length,
    frozenForbiddenEdges,
  };
}

function parseArguments(args) {
  const options = { predecessors: [], updateBaseline: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--update-baseline') {
      options.updateBaseline = true;
      continue;
    }
    if (args[index] === '--predecessor' && args[index + 1]) {
      options.predecessors.push(args[index + 1]);
      index += 1;
      continue;
    }
    throw new Error('usage: node scripts/check-module-ownership.mjs [--update-baseline] [--predecessor REV]...');
  }
  return options;
}

function defaultPredecessors() {
  const fromEnvironment = process.env[PREDECESSORS_ENV]?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  if (fromEnvironment.length > 0) return fromEnvironment;
  const changed = git([
    'status', '--porcelain=v1', '--untracked-files=normal', '--',
    'src', 'ownership.manifest.json', 'ownership.baseline.json', 'issues',
  ]).trim();
  if (changed !== '') return ['HEAD'];
  try {
    git(['rev-parse', '--verify', 'HEAD^']);
    return ['HEAD^'];
  } catch {
    return ['HEAD'];
  }
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const manifest = parseJson(MANIFEST_PATH, 'module ownership manifest');
    const analysis = analyzeSources(manifest, loadRepositorySources());
    const issues = loadRepositoryIssues();
    const llps = loadRepositoryLlps();
    const predecessorRevisions = options.predecessors.length > 0
      ? options.predecessors
      : defaultPredecessors();
    const predecessors = predecessorRevisions.map(loadRevisionSnapshot);

    if (options.updateBaseline) {
      assert(predecessors.length === 1, '--update-baseline requires exactly one predecessor');
      const candidate = buildBaselineDocument(analysis, manifest, predecessors[0], issues, llps);
      const current = {
        analysis,
        baseline: candidate,
        issues,
        llps,
        manifest,
        revision: 'working-tree',
      };
      const protocol = enforceSnapshotProtocol(current, predecessors);
      writeFileSync(BASELINE_PATH, `${JSON.stringify(candidate, null, 2)}\n`);
      process.stdout.write(
        `[module-ownership] UPDATED: ${analysis.moduleCount} modules; ${analysis.edges.length} current module edges; `
          + `${candidate.frozenForbiddenEdgeCount} frozen forbidden; ${protocol.inherited.length} tracked outstanding`
          + `${formatExpiredWaiverEscalation(protocol.expiredWaivers)}\n`,
      );
      return;
    }

    const baseline = parseJson(BASELINE_PATH, 'module ownership baseline');
    const result = summarizeBaselineDelta(manifest, analysis, baseline);
    const current = {
      analysis,
      baseline,
      issues,
      llps,
      manifest,
      revision: 'working-tree',
    };
    const protocol = enforceSnapshotProtocol(current, predecessors);

    const assignedCount = [...analysis.assignment.values()].filter((owner) => owner !== 'unassigned').length;
    const crossOwnerCount = analysis.edges.filter((edge) => edge.fromOwner !== edge.toOwner).length;
    process.stdout.write(
      `[module-ownership] PASS: ${analysis.moduleCount} modules (${assignedCount} assigned, `
        + `${analysis.moduleCount - assignedCount} unassigned); ${analysis.edges.length} module edges; `
        + `${crossOwnerCount} cross-owner; ${result.newEdges.length} new allowed; `
        + `${result.staleBaselineEdgeCount} stale baseline; `
        + `${protocol.inherited.length} inherited outstanding (${protocol.ticket ?? 'none'})`
        + `${formatExpiredWaiverEscalation(protocol.expiredWaivers)}; `
        + `${analysis.unresolvedReferenceCount} unresolved module references\n`,
    );
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
