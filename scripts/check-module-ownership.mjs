#!/usr/bin/env node

import {
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
// select this cheap textual gate through the checked local-proof policy.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = join(ROOT, 'ownership.manifest.json');
const BASELINE_PATH = join(ROOT, 'ownership.baseline.json');
const DIAGNOSTIC = 'SNAPBACK_MODULE_OWNERSHIP_VIOLATION';
const MANIFEST_SCHEMA = 'snapback.module-ownership-manifest.v1';
const BASELINE_SCHEMA_V1 = 'snapback.module-ownership-baseline.v1';
const BASELINE_SCHEMA = 'snapback.module-ownership-baseline.v2';
const PREDECESSORS_ENV = 'SNAPBACK_MODULE_OWNERSHIP_PREDECESSORS';
const FROZEN_EDGE_MARKER = 'module-ownership-frozen-edge:';
const FROZEN_DISPOSITIONS = new Set([
  'analyzer-upgrade',
  'relocation',
  'time-bounded-waiver',
]);
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
  const reexportIndex = buildReexportIndex(extracted);
  const resolutionCache = new Map();
  const edges = new Map();
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
        edges.set(edgeKey(edge), edge);
      }
    }
  }

  return {
    assignment,
    edges: [...edges.values()].sort(compareEdges),
    godFiles,
    moduleCount: rustFiles.length,
    unresolvedReferenceCount,
    unresolvedReferences,
  };
}

function validateAttribution(attribution, label) {
  assert(attribution && typeof attribution === 'object' && !Array.isArray(attribution), `${label} attribution must be an object`);
  assert(FROZEN_DISPOSITIONS.has(attribution.disposition), `${label} has invalid disposition ${attribution.disposition}`);
  assert(/^[0-9a-f]{7,40}$/u.test(attribution.observationRevision ?? ''), `${label} needs an observationRevision`);
  assert(/^issues\/[^/]+\.md$/u.test(attribution.worklist ?? ''), `${label} needs an open issues/ worklist path`);
  assert(typeof attribution.provenance === 'string' && attribution.provenance.trim().length >= 20, `${label} needs substantive provenance`);
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

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function loadRevisionSnapshot(revision) {
  const resolvedRevision = git(['rev-parse', '--verify', `${revision}^{commit}`]).trim();
  const paths = git(['ls-tree', '-r', '--name-only', resolvedRevision]).trim().split('\n').filter(Boolean);
  const read = (path) => git(['show', `${resolvedRevision}:${path}`]);
  const rustFiles = paths.filter((path) => /^src\/(?:[^/]+\/)*[^/]+\.rs$/u.test(path)).sort();
  const issuePaths = paths.filter((path) => /^issues\/[^/]+\.md$/u.test(path)).sort();
  const manifest = JSON.parse(read('ownership.manifest.json'));
  const baseline = JSON.parse(read('ownership.baseline.json'));
  const sources = new Map(rustFiles.map((path) => [path, read(path)]));
  const issues = new Map(issuePaths.map((path) => [path, read(path)]));
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
  return { analysis, baseline, issues, manifest, revision: resolvedRevision };
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
      const attribution = {
        disposition: record.disposition,
        observationRevision: record.observationRevision,
        worklist: path,
        provenance: record.provenance,
        ...(record.inversionOwner === undefined ? {} : { inversionOwner: record.inversionOwner }),
        ...(record.deadline === undefined ? {} : { deadline: record.deadline }),
        ...(record.predecessorFingerprint === undefined
          ? {}
          : { predecessorFingerprint: record.predecessorFingerprint }),
      };
      validateAttribution(attribution, `${path}: ${fingerprint}`);
      records.set(fingerprint, { fingerprint, attribution });
    }
  }
  return records;
}

function forbiddenEdges(manifest, analysis) {
  return analysis.edges
    .map((edge) => ({ ...edge, reason: violationReason(edge, manifest, analysis.godFiles) }))
    .filter((edge) => edge.reason !== null);
}

function waiverFingerprints(records) {
  return new Set([...records.values()]
    .filter((record) => record.attribution.disposition === 'time-bounded-waiver')
    .map((record) => record.fingerprint));
}

function expiredWaiverFingerprints(records, today) {
  return [...records.values()]
    .filter((record) => record.attribution.disposition === 'time-bounded-waiver'
      && record.attribution.deadline < today)
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
  const worklistRecords = parseFrozenEdgeRecords(current.issues);
  const growth = [...currentBaseline.frozen.keys()]
    .filter((fingerprint) => !predecessorBaseline.frozen.has(fingerprint))
    .sort();
  const removed = [...predecessorBaseline.frozen.keys()]
    .filter((fingerprint) => !currentBaseline.frozen.has(fingerprint));
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
    if (frozen.attribution.disposition === 'time-bounded-waiver') {
      assert(
        frozen.attribution.deadline >= today,
        `${worklist.attribution.worklist} waiver expired ${frozen.attribution.deadline}: ${fingerprint}`,
      );
    }
    if (frozen.attribution.disposition === 'analyzer-upgrade') {
      assert(
        predecessorForbidden.has(fingerprint),
        `analyzer-upgrade record does not name an edge present at predecessor ${predecessor.revision}: ${fingerprint}`,
      );
    }
    if (frozen.attribution.disposition === 'relocation') {
      const priorFingerprint = frozen.attribution.predecessorFingerprint;
      assert(
        removed.includes(priorFingerprint) && predecessorBaseline.frozen.has(priorFingerprint),
        `relocation record does not re-key its named predecessor frozen edge ${priorFingerprint}: ${fingerprint}`,
      );
      const currentEdge = current.analysis.edges.find((edge) => edgeFingerprint(edge) === fingerprint);
      const priorEdge = predecessor.analysis.edges.find((edge) => edgeFingerprint(edge) === priorFingerprint);
      assert(currentEdge && priorEdge, `relocation fingerprints must exist in both analyzed source graphs: ${fingerprint}`);
      assert(
        currentEdge.fromOwner === priorEdge.fromOwner && currentEdge.toOwner === priorEdge.toOwner,
        `relocation must retain the predecessor owner pair ${priorEdge.fromOwner} → ${priorEdge.toOwner}: ${fingerprint}`,
      );
    }
  }
  return { growth, removed };
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

function baselineDocument(analysis, manifest, predecessor, issueSources) {
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
    if (attributed) {
      frozenForbiddenEdges.push(attributed);
      continue;
    }
    const retained = previous.frozen.get(fingerprint);
    if (retained) {
      frozenForbiddenEdges.push(retained);
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
    const predecessorRevisions = options.predecessors.length > 0
      ? options.predecessors
      : defaultPredecessors();
    const predecessors = predecessorRevisions.map(loadRevisionSnapshot);

    if (options.updateBaseline) {
      assert(predecessors.length === 1, '--update-baseline requires exactly one predecessor');
      const candidate = baselineDocument(analysis, manifest, predecessors[0], issues);
      const current = {
        analysis,
        baseline: candidate,
        issues,
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
