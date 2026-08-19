#!/usr/bin/env node

// @ref LLP 0276#crates--the-rust-workspace — Cargo construction prevents
// absent edges; this fail-closed projection checks the allowed matrix,
// external confinement, ownership assignment, and publish posture.

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const ROOT_REAL = realpathSync(ROOT);
const MATRIX_PATH = resolve(ROOT, 'crates/allowed-dependencies.v1.json');
const OWNERSHIP_PATH = resolve(ROOT, 'ownership.manifest.json');
const DIAGNOSTIC = 'SNAPBACK_WORKSPACE_GRAPH_VIOLATION';

const EXPECTED_CRATES = [
  ['snapback-types', 'shared-contract-types-leaf', 0, []],
  ['snapback-kernel', 'storage-migration-kernel', 1, ['snapback-types']],
  ['snapback-auth', 'auth-substrate', 2, ['snapback-kernel', 'snapback-types']],
  ['snapback-activation', 'generation-activation-coordinator', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-runtime', 'js-execution', 3, ['snapback-types']],
  ['snapback-services', 'background-services', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-sync', 'sync-realtime-engine', 3, ['snapback-auth', 'snapback-kernel', 'snapback-types']],
  ['snapback-engine', 'engine-coordinator', 4, ['snapback-activation', 'snapback-auth', 'snapback-kernel', 'snapback-runtime', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-server', 'transport-adapters', 5, ['snapback-activation', 'snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-cli', 'transport-adapters', 6, ['snapback-activation', 'snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback', 'embed-facade', 7, ['snapback-activation', 'snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
  ['snapback-conformance', 'proof-harness', 7, ['snapback-auth', 'snapback-engine', 'snapback-kernel', 'snapback-server', 'snapback-types']],
  ['snapback-tools', 'dev-tools', 7, ['snapback-activation', 'snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
].map(([name, owner, rank, allowedWorkspaceDependencies]) => ({ name, owner, rank, allowedWorkspaceDependencies }));

const EXPECTED_CONFINEMENT = [
  ['axum', ['snapback-server']],
  ['celld-ltx', ['snapback-services']],
  ['clap', ['snapback-cli']],
  ['ibex-runtime', ['snapback-runtime']],
  ['rusqlite', ['snapback-kernel', 'snapback-services']],
].map(([dependency, allowedMembers]) => ({ dependency, allowedMembers }));
const EXPECTED_WORKSPACE_MEMBERS = ['crates/*'];
const EXPECTED_WORKSPACE_DEFAULT_MEMBERS = ['crates/snapback'];
const EXPECTED_WORKSPACE_EXCLUDE = [
  'tools/agent-safe-baseline-worker',
  'vendor/ibex',
  'vendor/celld-ltx',
];
const OWNER_CRATE_ROOTS = {
  'shared-contract-types-leaf': ['crates/snapback-types'],
  'generation-activation-coordinator': ['crates/snapback-activation'],
  'storage-migration-kernel': ['crates/snapback-kernel'],
  'sync-realtime-engine': ['crates/snapback-sync'],
  'background-services': ['crates/snapback-services'],
  'transport-adapters': ['crates/snapback-cli', 'crates/snapback-server'],
  'embed-facade': ['crates/snapback'],
  unassigned: [],
};
const EXPECTED_ENGINE_DEFINITION_DENYLIST = [
  { kind: 'symbol', symbol: 'activation' },
  { kind: 'symbol', symbol: 'auth' },
  { kind: 'symbol', symbol: 'search' },
  { kind: 'symbol', symbol: 'AuthProvisionCommit' },
  { kind: 'symbol', symbol: 'PreparedAuthProvision' },
];
const SAFE_ENGINE_MACROS = new Set([
  'assert',
  'assert_eq',
  'assert_ne',
  'cfg',
  'debug_assert',
  'debug_assert_eq',
  'env',
  'eprintln',
  'format',
  'if',
  'include_bytes',
  'include_str',
  'json',
  'matches',
  'panic',
  'params',
  'println',
  'rusqlite::params',
  'serde_json::json',
  'thread_local',
  'unreachable',
  'vec',
  'write',
]);
const SAFE_ENGINE_ATTRIBUTES = new Set([
  'allow',
  'cfg',
  'cfg_attr',
  'derive',
  'doc',
  'inline',
  'path',
  'repr',
  'schemars',
  'serde',
  'should_panic',
  'test',
  'tokio::test',
]);
const SAFE_ENGINE_DERIVES = new Set([
  'Clone',
  'Copy',
  'Debug',
  'Default',
  'Deserialize',
  'Eq',
  'Ord',
  'PartialEq',
  'PartialOrd',
  'Serialize',
  'schemars::JsonSchema',
  'serde::Deserialize',
  'serde::Serialize',
]);
const TRUSTED_ENGINE_BINDINGS = new Set([
  ...SAFE_ENGINE_MACROS,
  ...SAFE_ENGINE_DERIVES,
  ...SAFE_ENGINE_ATTRIBUTES,
  'rusqlite',
  'schemars',
  'serde',
  'serde_json',
  'snapback_services',
  'std',
  'tokio',
]);
const CANONICAL_ENGINE_IMPORTS = new Map([
  ['Deserialize', 'serde'],
  ['JsonSchema', 'schemars'],
  ['Serialize', 'serde'],
  ['env', 'std'],
  ['json', 'serde_json'],
  ['params', 'snapback_services::test_support::rusqlite'],
  ['rusqlite', 'snapback_services::test_support'],
]);
const TRUSTED_ENGINE_CRATE_BINDINGS = new Set([
  'rusqlite',
  'schemars',
  'serde',
  'serde_json',
  'snapback_services',
  'std',
  'tokio',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sortedUniqueStrings(values, label) {
  assert(Array.isArray(values), `${label} must be an array`);
  assert(values.every((value) => typeof value === 'string' && value.length > 0), `${label} must contain strings`);
  assert(new Set(values).size === values.length, `${label} contains duplicates`);
  assert(JSON.stringify(values) === JSON.stringify([...values].sort()), `${label} must be sorted`);
}

function workspaceArray(manifestSource, key) {
  assert(typeof manifestSource === 'string', 'root Cargo.toml is unreadable');
  const header = /^\[workspace\]\s*$/mu.exec(manifestSource);
  assert(header !== null, 'root Cargo.toml lacks [workspace]');
  const tail = manifestSource.slice(header.index + header[0].length);
  const nextHeader = tail.search(/^\[/mu);
  const section = nextHeader === -1 ? tail : tail.slice(0, nextHeader);
  const value = section.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'mu'))?.[1];
  assert(value !== undefined, `workspace.${key} is missing`);
  return [...value.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
}

function validateWorkspaceManifest(manifestSource) {
  assert(
    JSON.stringify(workspaceArray(manifestSource, 'members'))
      === JSON.stringify(EXPECTED_WORKSPACE_MEMBERS),
    'workspace.members drifted from the Phase 1 trap-safe set',
  );
  assert(
    JSON.stringify(workspaceArray(manifestSource, 'default-members'))
      === JSON.stringify(EXPECTED_WORKSPACE_DEFAULT_MEMBERS),
    'workspace.default-members drifted from the Phase 1 trap-safe set',
  );
  assert(
    JSON.stringify(workspaceArray(manifestSource, 'exclude'))
      === JSON.stringify(EXPECTED_WORKSPACE_EXCLUDE),
    'workspace.exclude drifted from the Phase 1 trap-safe set',
  );
}

function readRustTree(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return readRustTree(path);
      return entry.isFile() && entry.name.endsWith('.rs') ? [readFileSync(path, 'utf8')] : [];
    })
    .join('\n');
}

function pathIsInside(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function validateCanonicalRepositoryPath(path, label) {
  assert(typeof path === 'string' && path.length > 0, `${label} must be a non-empty string`);
  assert(!path.includes('\\'), `${label} must use repository '/' separators: ${path}`);
  assert(!posix.isAbsolute(path), `${label} must be repository-relative: ${path}`);
  assert(path !== '..' && !path.startsWith('../'), `${label} escapes the repository: ${path}`);
  assert(posix.normalize(path) === path, `${label} must be canonical: ${path}`);
}

export function canonicalRegularFileExists(root, path) {
  try {
    const absolute = resolve(root, path);
    if (!lstatSync(absolute).isFile()) return false;
    return realpathSync(absolute) === resolve(realpathSync(root), path);
  } catch {
    return false;
  }
}

function workspaceMemberForPath(path) {
  const match = /^crates\/([^/]+)\//u.exec(path);
  return match?.[1];
}

// @ref LLP 0189#decision —
//   analyzer retirement may not silently drop module-home coverage.
export function validateModuleOwnership(
  artifact,
  ownership,
  pathExists = (path) => canonicalRegularFileExists(ROOT_REAL, path),
  today = new Date().toISOString().slice(0, 10),
) {
  assert(ownership?.schemaVersion === 'snapback.module-ownership-manifest.v1', 'ownership manifest schemaVersion is invalid');
  assert(ownership.modulesByOwner && typeof ownership.modulesByOwner === 'object', 'ownership manifest modulesByOwner is invalid');
  const assignments = [];
  for (const [owner, modules] of Object.entries(ownership.modulesByOwner)) {
    assert(Object.hasOwn(OWNER_CRATE_ROOTS, owner), `ownership manifest contains unknown owner ${owner}`);
    sortedUniqueStrings(modules, `modulesByOwner.${owner}`);
    for (const module of modules) validateCanonicalRepositoryPath(module, `modulesByOwner.${owner} path`);
    assignments.push(...modules.map((module) => ({ module, owner })));
  }
  const assignmentKeys = assignments.map(({ module }) => module);
  assert(new Set(assignmentKeys).size === assignmentKeys.length, 'ownership manifest assigns a module more than once');

  const exceptions = artifact.membershipExceptions;
  assert(Array.isArray(exceptions), 'membershipExceptions must be an array');
  const exceptionNames = new Set();
  const exceptionAssignments = new Map();
  for (const exception of exceptions) {
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(exception?.name ?? ''), 'membership exception requires a kebab-case name');
    assert(!exceptionNames.has(exception.name), `duplicate membership exception name ${exception.name}`);
    exceptionNames.add(exception.name);
    assert(typeof exception.reason === 'string' && exception.reason.length > 0, `${exception.name} requires a reason`);
    assert(/^\d{4}-\d{2}-\d{2}$/u.test(exception.expiresAt ?? ''), `${exception.name} requires a YYYY-MM-DD expiresAt`);
    assert(exception.expiresAt >= today, `${exception.name} expired on ${exception.expiresAt}`);
    assert(/^issues\/\d{8}-[^/]+\.md$/u.test(exception.ticket ?? ''), `${exception.name} requires an issues/ burn-down ticket`);
    validateCanonicalRepositoryPath(exception.ticket, `${exception.name} ticket`);
    assert(pathExists(exception.ticket), `${exception.name} burn-down ticket does not exist: ${exception.ticket}`);
    assert((artifact.crates ?? []).some(({ name }) => name === exception.actualMember), `${exception.name} names unknown actualMember ${exception.actualMember}`);
    assert(Array.isArray(exception.assignments) && exception.assignments.length > 0, `${exception.name}.assignments must be a non-empty array`);
    for (const assignment of exception.assignments) {
      assert(typeof assignment?.module === 'string' && assignment.module.length > 0, `${exception.name} contains an invalid module`);
      validateCanonicalRepositoryPath(assignment.module, `${exception.name} module`);
      assert(Object.hasOwn(OWNER_CRATE_ROOTS, assignment.assignedOwner), `${exception.name} contains unknown assignedOwner ${assignment.assignedOwner}`);
      const key = `${assignment.assignedOwner}\0${assignment.module}`;
      assert(!exceptionAssignments.has(key), `membership exception assignment is duplicated: ${assignment.module}`);
      exceptionAssignments.set(key, { ...exception, used: false });
    }
  }

  for (const { module, owner } of assignments) {
    assert(pathExists(module), `assigned module does not exist: ${module}`);
    const assignedRoots = OWNER_CRATE_ROOTS[owner];
    if (assignedRoots.some((root) => pathIsInside(module, root))) continue;
    const key = `${owner}\0${module}`;
    const exception = exceptionAssignments.get(key);
    assert(exception, `module ${module} is outside assigned owner ${owner} and has no named membership exception`);
    assert(workspaceMemberForPath(module) === exception.actualMember, `${exception.name} actualMember does not match ${module}`);
    exception.used = true;
    exceptionAssignments.set(key, exception);
  }
  for (const [key, exception] of exceptionAssignments) {
    assert(exception.used, `${exception.name} does not match an out-of-owner manifest module (${key.split('\0')[1]})`);
  }
}

export function rustSourceFiles(directory) {
  const directoryMetadata = lstatSync(directory);
  assert(
    directoryMetadata.isDirectory() && !directoryMetadata.isSymbolicLink(),
    `Rust source root must be a real directory: ${relative(ROOT, directory).split(sep).join('/')}`,
  );
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Rust source tree contains a symlink: ${relative(ROOT, path).split(sep).join('/')}`);
    if (entry.isDirectory()) return rustSourceFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.rs')) return [];
    return [{ path, source: readFileSync(path, 'utf8') }];
  });
}

function maskRangeExceptNewlines(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== '\n' && characters[index] !== '\r') characters[index] = ' ';
  }
}

function rawStringEnd(source, start) {
  let cursor = start;
  if ((source[cursor] === 'b' || source[cursor] === 'c') && source[cursor + 1] === 'r') {
    cursor += 2;
  } else if (source[cursor] === 'r') {
    cursor += 1;
  } else {
    return undefined;
  }
  const hashesStart = cursor;
  while (source[cursor] === '#') cursor += 1;
  if (source[cursor] !== '"') return undefined;
  const terminator = `"${'#'.repeat(cursor - hashesStart)}`;
  const terminatorStart = source.indexOf(terminator, cursor + 1);
  return terminatorStart === -1 ? source.length : terminatorStart + terminator.length;
}

function quotedEnd(source, start, delimiter) {
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === delimiter) return cursor + 1;
    cursor += 1;
  }
  return source.length;
}

function charLiteralEnd(source, start) {
  let cursor = start + 1;
  if (source[cursor] === '\\') return quotedEnd(source, start, "'");
  const codePoint = source.codePointAt(cursor);
  if (codePoint === undefined) return undefined;
  cursor += codePoint > 0xffff ? 2 : 1;
  return source[cursor] === "'" ? cursor + 1 : undefined;
}

// Preserve code layout while removing every lexical region whose contents
// cannot define a Rust item. This makes the denylist insensitive to comments
// between tokens without treating comment/string examples as definitions.
export function maskRustCommentsAndLiterals(source) {
  const characters = source.split('');
  let cursor = 0;
  while (cursor < source.length) {
    const rawEnd = rawStringEnd(source, cursor);
    if (rawEnd !== undefined) {
      maskRangeExceptNewlines(characters, cursor, rawEnd);
      cursor = rawEnd;
      continue;
    }
    if (source.startsWith('//', cursor)) {
      const end = source.indexOf('\n', cursor + 2);
      const maskedEnd = end === -1 ? source.length : end;
      maskRangeExceptNewlines(characters, cursor, maskedEnd);
      cursor = maskedEnd;
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
      maskRangeExceptNewlines(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (source[cursor] === '"') {
      const end = quotedEnd(source, cursor, '"');
      maskRangeExceptNewlines(characters, cursor, end);
      cursor = end;
      continue;
    }
    if (source[cursor] === "'") {
      const end = charLiteralEnd(source, cursor);
      if (end !== undefined) {
        maskRangeExceptNewlines(characters, cursor, end);
        cursor = end;
        continue;
      }
    }
    cursor += 1;
  }
  return characters.join('');
}

function maskRustAttributes(source) {
  const characters = source.split('');
  let cursor = 0;
  while (cursor < source.length) {
    if (source[cursor] !== '#') {
      cursor += 1;
      continue;
    }
    let bracket = cursor + 1;
    while (/\s/u.test(source[bracket] ?? '')) bracket += 1;
    if (source[bracket] === '!') {
      bracket += 1;
      while (/\s/u.test(source[bracket] ?? '')) bracket += 1;
    }
    if (source[bracket] !== '[') {
      cursor += 1;
      continue;
    }
    let depth = 1;
    let end = bracket + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '[') depth += 1;
      if (source[end] === ']') depth -= 1;
      end += 1;
    }
    maskRangeExceptNewlines(characters, cursor, end);
    cursor = end;
  }
  return characters.join('');
}

function rustAttributes(source) {
  const attributes = [];
  let cursor = 0;
  while (cursor < source.length) {
    const rawEnd = rawStringEnd(source, cursor);
    if (rawEnd !== undefined) {
      cursor = rawEnd;
      continue;
    }
    if (source.startsWith('//', cursor)) {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      let depth = 1;
      cursor += 2;
      while (cursor < source.length && depth > 0) {
        if (source.startsWith('/*', cursor)) {
          depth += 1;
          cursor += 2;
        } else if (source.startsWith('*/', cursor)) {
          depth -= 1;
          cursor += 2;
        } else {
          cursor += 1;
        }
      }
      continue;
    }
    if (source[cursor] === '"') {
      cursor = quotedEnd(source, cursor, '"');
      continue;
    }
    if (source[cursor] === "'") {
      const end = charLiteralEnd(source, cursor);
      if (end !== undefined) {
        cursor = end;
        continue;
      }
    }
    if (source[cursor] !== '#') {
      cursor += 1;
      continue;
    }
    let bracket = cursor + 1;
    while (/\s/u.test(source[bracket] ?? '')) bracket += 1;
    if (source[bracket] === '!') {
      bracket += 1;
      while (/\s/u.test(source[bracket] ?? '')) bracket += 1;
    }
    if (source[bracket] !== '[') {
      cursor += 1;
      continue;
    }
    let depth = 1;
    let end = bracket + 1;
    while (end < source.length && depth > 0) {
      const nestedRawEnd = rawStringEnd(source, end);
      if (nestedRawEnd !== undefined) {
        end = nestedRawEnd;
        continue;
      }
      if (source.startsWith('//', end)) {
        const lineEnd = source.indexOf('\n', end + 2);
        end = lineEnd === -1 ? source.length : lineEnd;
        continue;
      }
      if (source.startsWith('/*', end)) {
        let commentDepth = 1;
        end += 2;
        while (end < source.length && commentDepth > 0) {
          if (source.startsWith('/*', end)) {
            commentDepth += 1;
            end += 2;
          } else if (source.startsWith('*/', end)) {
            commentDepth -= 1;
            end += 2;
          } else {
            end += 1;
          }
        }
        continue;
      }
      if (source[end] === '"') {
        end = quotedEnd(source, end, '"');
        continue;
      }
      if (source[end] === "'") {
        const literalEnd = charLiteralEnd(source, end);
        if (literalEnd !== undefined) {
          end = literalEnd;
          continue;
        }
      }
      if (source[end] === '[') depth += 1;
      if (source[end] === ']') depth -= 1;
      end += 1;
    }
    assert(depth === 0, 'Rust source contains an unterminated attribute');
    attributes.push(source.slice(cursor, end));
    cursor = end;
  }
  return attributes;
}

function validateEngineDefinitionInputs(files) {
  const engineRoot = realpathSync(resolve(ROOT, 'crates/snapback-engine/src'));
  for (const file of files) {
    for (const attribute of rustAttributes(file.source)) {
      const head = /^#\s*!?\s*\[\s*([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)/su.exec(attribute)?.[1];
      assert(
        head && SAFE_ENGINE_ATTRIBUTES.has(head),
        `snapback-engine uses an unreviewed attribute ${head ?? '<unknown>'}: ${relative(ROOT, file.path).split(sep).join('/')}`,
      );
      if (head === 'derive') {
        const derives = /^#\s*!?\s*\[\s*derive\s*\(([^)]*)\)\s*\]$/su.exec(attribute)?.[1]
          ?.split(',')
          .map((derive) => derive.trim())
          .filter(Boolean);
        assert(
          derives?.length > 0 && derives.every((derive) => SAFE_ENGINE_DERIVES.has(derive)),
          `snapback-engine uses an unreviewed derive: ${relative(ROOT, file.path).split(sep).join('/')}`,
        );
      }
      if (head === 'cfg_attr') {
        assert(
          /^#\s*!?\s*\[\s*cfg_attr\s*\(\s*(?:not\s*\(\s*test\s*\)|any\s*\(\s*\))\s*,\s*(?:allow\s*\(\s*dead_code\s*\)|inline)\s*\)\s*\]$/su.test(attribute),
          `snapback-engine cfg_attr may not hide an unreviewed item attribute: ${relative(ROOT, file.path).split(sep).join('/')}`,
        );
      }
      if (head !== 'path') continue;
      const match = /^#\s*!?\s*\[\s*path\s*=\s*"([^"\\]+)"\s*\]$/su.exec(attribute);
      assert(match, `engine #[path] must use one simple relative file path: ${relative(ROOT, file.path).split(sep).join('/')}`);
      const modulePath = match[1];
      assert(
        modulePath.endsWith('.rs')
          &&
        !posix.isAbsolute(modulePath)
          && posix.normalize(modulePath) === modulePath
          && modulePath !== '..'
          && !modulePath.startsWith('../'),
        `engine #[path] escapes its source tree: ${modulePath}`,
      );
      const target = resolve(dirname(file.path), modulePath);
      const targetRelative = relative(engineRoot, target);
      assert(
        targetRelative.length > 0
          && targetRelative !== '..'
          && !targetRelative.startsWith(`..${sep}`)
          && canonicalRegularFileExists(engineRoot, targetRelative.split(sep).join('/')),
        `engine #[path] must resolve to a real file inside snapback-engine/src: ${modulePath}`,
      );
    }

    const masked = maskRustAttributes(maskRustCommentsAndLiterals(file.source));
    for (const externMatch of masked.matchAll(/(?:^|[;{}])\s*(?:pub(?:\s*\([^)]*\))?\s+)?extern\s+crate\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*))?\s*;/gmu)) {
      const binding = externMatch[2] ?? externMatch[1];
      assert(
        !TRUSTED_ENGINE_BINDINGS.has(binding) || externMatch[1] === binding,
        `snapback-engine may not alias an extern crate to trusted macro binding ${binding}: ${relative(ROOT, file.path).split(sep).join('/')}`,
      );
    }
    for (const useMatch of masked.matchAll(/(?:^|[;{}])\s*(?:pub(?:\s*\([^)]*\))?\s+)?use\s+([^;]+);/gmu)) {
      const useSpec = useMatch[1];
      for (const alias of useSpec.matchAll(/\bas\s+(?:r#)?([A-Za-z_][A-Za-z0-9_]*)/gu)) {
        assert(
          !TRUSTED_ENGINE_BINDINGS.has(alias[1]),
          `snapback-engine may not alias a trusted macro binding ${alias[1]}: ${relative(ROOT, file.path).split(sep).join('/')}`,
        );
      }
      for (const binding of TRUSTED_ENGINE_BINDINGS) {
        const simpleBinding = binding.includes('::') ? binding.slice(binding.lastIndexOf('::') + 2) : binding;
        const imported = new RegExp(
          String.raw`(?:^|::|[,{])\s*(?:r#)?${simpleBinding}\s*(?:,|\}|$)`,
          'u',
        ).test(useSpec);
        if (!imported) continue;
        const canonicalCrate = CANONICAL_ENGINE_IMPORTS.get(simpleBinding);
        assert(
          canonicalCrate && useSpec.trimStart().startsWith(`${canonicalCrate}::`),
          `snapback-engine may not import trusted macro binding ${simpleBinding} from an unreviewed path: ${relative(ROOT, file.path).split(sep).join('/')}`,
        );
      }
    }
    assert(
      !/(?:^|[;{}])\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:mod|type|struct|enum|union|trait)\s+(?:r#)?(?:rusqlite|schemars|serde|serde_json|snapback_services|std|tokio)\b/mu.test(masked),
      `snapback-engine may not shadow a trusted macro crate binding: ${relative(ROOT, file.path).split(sep).join('/')}`,
    );
    assert(
      !/\bmacro_rules\s*!/u.test(masked) && !/(?:^|[;{}])\s*(?:pub(?:\s*\([^)]*\))?\s+)?macro\s+(?:r#)?[A-Za-z_][A-Za-z0-9_]*/mu.test(masked),
      `snapback-engine may not define item-generating macros: ${relative(ROOT, file.path).split(sep).join('/')}`,
    );
    for (const match of masked.matchAll(/\b((?:[A-Za-z_][A-Za-z0-9_]*::)*(?:r#)?[A-Za-z_][A-Za-z0-9_]*)\s*!\s*[({\[]/gu)) {
      assert(
        SAFE_ENGINE_MACROS.has(match[1]),
        `snapback-engine uses an unreviewed macro ${match[1]}!: ${relative(ROOT, file.path).split(sep).join('/')}`,
      );
    }
  }
}

export function validateEngineDefinitionDenylist(artifact, files = rustSourceFiles(resolve(ROOT, 'crates/snapback-engine/src'))) {
  assert(
    JSON.stringify(artifact.engineDefinitionDenylist) === JSON.stringify(EXPECTED_ENGINE_DEFINITION_DENYLIST),
    'engine definition denylist drifted from the Phase 2 flip predicate',
  );
  validateEngineDefinitionInputs(files);
  const visibility = String.raw`(?:pub(?:\s*\([^)]*\))?\s+)?`;
  for (const entry of artifact.engineDefinitionDenylist) {
    const declaration = String.raw`(?:`
      + String.raw`(?:(?:const|async|unsafe|safe|default)\s+|extern(?:\s+"[^"]*")?\s+)*fn`
      + String.raw`|(?:(?:unsafe|auto)\s+)*(?:struct|enum|union|trait|type)`
      + String.raw`|mod|const|static(?:\s+mut)?|macro_rules\s*!|macro)`;
    const pattern = new RegExp(
      String.raw`(?:^|[;{}])\s*${visibility}${declaration}\s+(?:r#)?${entry.symbol}\b`,
      'mu',
    );
    for (const file of files) {
      assert(
        !pattern.test(maskRustAttributes(maskRustCommentsAndLiterals(file.source))),
        `snapback-engine defines forbidden ${entry.kind} ${entry.symbol} in ${relative(ROOT, file.path).split(sep).join('/')}`,
      );
    }
  }
}

function validateKernelAdmissionFacades() {
  const facade = readFileSync(resolve(ROOT, 'crates/snapback/src/lib.rs'), 'utf8');
  const pushAdapter = readFileSync(resolve(ROOT, 'crates/snapback-engine/src/push.rs'), 'utf8');
  const facadeRust = [
    readRustTree(resolve(ROOT, 'crates/snapback/src')),
    readRustTree(resolve(ROOT, 'crates/snapback-cli/src')),
    readRustTree(resolve(ROOT, 'crates/snapback-engine/src')),
    readRustTree(resolve(ROOT, 'crates/snapback-server/src')),
  ].join('\n');
  const pushKernel = readFileSync(
    resolve(ROOT, 'crates/snapback-kernel/src/storage/push_registry.rs'),
    'utf8',
  );
  const storageKernel = readFileSync(
    resolve(ROOT, 'crates/snapback-kernel/src/storage.rs'),
    'utf8',
  );
  const connectionKernel = readFileSync(
    resolve(ROOT, 'crates/snapback-kernel/src/storage/connections.rs'),
    'utf8',
  );
  const jobsKernel = readFileSync(
    resolve(ROOT, 'crates/snapback-kernel/src/storage/jobs.rs'),
    'utf8',
  );
  const invocationSync = readFileSync(
    resolve(ROOT, 'crates/snapback-sync/src/auth/invocation.rs'),
    'utf8',
  );
  const forkService = readFileSync(
    resolve(ROOT, 'crates/snapback-services/src/instance_fork/service.rs'),
    'utf8',
  );
  assert(
    !/^pub use snapback_server::auth;/mu.test(facade)
      && /pub mod auth\s*\{[\s\S]*pub\(crate\) use snapback_auth::auth::\{admission,/u.test(facade),
    'facade auth must remain a curated projection without public admission internals',
  );
  assert(
    !/pub mod instance_fork\s*\{[\s\S]*?pub use snapback_kernel::instance_fork::\*;/u.test(facade)
      && !/pub mod instance_fork\s*\{[\s\S]*?pub use snapback_services::instance_fork::\*;/u.test(facade),
    'facade instance_fork must not wildcard-export raw kernel or service authority helpers',
  );
  assert(
    !/^pub use snapback_kernel::proof_checkpoint;/mu.test(facade),
    'proof/checkpoint kernel primitives must not be re-exported by the facade',
  );
  assert(
    !/^pub use snapback_kernel::push::\*;/mu.test(pushAdapter),
    'raw kernel push primitives must not be re-exported by the facade',
  );
  assert(
    /pub\(crate\) fn admitted_push_storage_authority\([\s\S]*authority: &crate::auth::invocation::PreparedAuthority/u.test(pushAdapter)
      && !/pub trait PreparedPushRegistryExt/u.test(pushAdapter),
    'push storage authority adapter must remain crate-private and consume PreparedAuthority',
  );
  assert(
    (facadeRust.match(/\.reserve_send_admitted_storage\(/gu) ?? []).length === 1,
    'only the prepared-authority adapter may call the kernel push commit entrypoint',
  );
  assert(
    /pub fn reserve_send_admitted_storage\([\s\S]*authority: crate::push::PushStorageAuthority/u.test(pushKernel),
    'kernel push commit entrypoint drifted from its storage-only authority carrier',
  );
  assert(
    !/pub fn conn\s*\(/u.test(storageKernel)
      && !/pub fn conn\s*\(/u.test(connectionKernel)
      && !/pub fn checkout\s*\(/u.test(connectionKernel),
    'kernel storage must not publish raw reader or writer connection accessors',
  );
  assert(
    forkService.includes('crate::storage::renew_derived_fork_lineage_v1(')
      && !forkService.includes('open_registered_system_writer_v1('),
    'fork lineage renewal must remain a typed kernel transaction',
  );
  assert(
    /pub struct DeferredRehearsalAuthority\s*\{\s*provenance:/u.test(jobsKernel)
      && !/pub struct DeferredRehearsalAuthority\s*\{\s*pub\s+provenance:/u.test(jobsKernel),
    'deferred rehearsal provenance must remain an opaque kernel-minted carrier',
  );
  assert(
    /pub struct RehearsalAuthorityBinding\s*\{\s*registry:/u.test(invocationSync)
      && !/pub fn with_deferred_rehearsal_provenance/u.test(invocationSync),
    'rehearsal preparation must consume the opaque coordinator binding, not raw asserted facts',
  );
}

export function validateArtifactAndMetadata(artifact, metadata, workspaceManifestSource) {
  validateWorkspaceManifest(workspaceManifestSource);
  assert(artifact?.schemaVersion === 'snapback.allowed-dependencies.v1', 'matrix schemaVersion is invalid');
  assert(JSON.stringify(artifact.crates) === JSON.stringify(EXPECTED_CRATES), 'matrix crate rows drifted from LLP 0276');
  assert(JSON.stringify(artifact.externalConfinement) === JSON.stringify(EXPECTED_CONFINEMENT), 'external confinement drifted from LLP 0276');
  const matrix = new Map(artifact.crates.map((entry) => [entry.name, entry]));
  assert(matrix.size === artifact.crates.length, 'matrix contains duplicate crate names');
  for (const entry of artifact.crates) {
    sortedUniqueStrings(entry.allowedWorkspaceDependencies, `${entry.name}.allowedWorkspaceDependencies`);
    for (const dependency of entry.allowedWorkspaceDependencies) {
      const target = matrix.get(dependency);
      assert(target, `${entry.name} allows unknown workspace dependency ${dependency}`);
      assert(entry.rank > target.rank, `${entry.name} -> ${dependency} is not strictly downward`);
    }
  }

  const packagesById = new Map((metadata?.packages ?? []).map((entry) => [entry.id, entry]));
  const members = (metadata?.workspace_members ?? []).map((id) => packagesById.get(id));
  assert(members.length > 0 && members.every(Boolean), 'cargo metadata returned missing or zero workspace members');
  const memberNames = new Set(members.map((entry) => entry.name));
  assert(memberNames.size === members.length, 'workspace contains duplicate package names');
  assert(!Object.hasOwn(artifact, 'remainderConfinementExemption'), 'the Phase 2 flip forbids a remainder-confinement exemption');

  for (const member of members) {
    const row = matrix.get(member.name);
    assert(row, `workspace member ${member.name} has no owner/rank assignment`);
    assert(Array.isArray(member.publish) && member.publish.length === 0, `${member.name} must set publish = false`);
    const dependencies = new Set((member.dependencies ?? []).map((entry) => entry.name));
    if (member.name === 'snapback-engine') {
      for (const dependency of member.dependencies ?? []) {
        const binding = dependency.rename ?? dependency.name;
        assert(
          !TRUSTED_ENGINE_CRATE_BINDINGS.has(binding) || dependency.name === binding,
          `snapback-engine may not rename ${dependency.name} to trusted macro crate binding ${binding}`,
        );
      }
    }
    for (const dependency of dependencies) {
      if (memberNames.has(dependency)) {
        assert(row.allowedWorkspaceDependencies.includes(dependency), `${member.name} may not depend on workspace member ${dependency}`);
      }
    }
    for (const rule of artifact.externalConfinement) {
      if (!dependencies.has(rule.dependency) || rule.allowedMembers.includes(member.name)) continue;
      assert(false, `${member.name} may not depend on confined external ${rule.dependency}`);
    }
  }
  const defaultMembers = (metadata?.workspace_default_members ?? [])
    .map((id) => packagesById.get(id));
  assert(
    defaultMembers.length === 1
      && defaultMembers[0]?.name === 'snapback',
    'cargo metadata default workspace member must be snapback',
  );
  return { members: [...memberNames].sort(), plannedCrates: matrix.size };
}

function main() {
  try {
    validateKernelAdmissionFacades();
    const artifact = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));
    const ownership = JSON.parse(readFileSync(OWNERSHIP_PATH, 'utf8'));
    validateModuleOwnership(artifact, ownership);
    validateEngineDefinitionDenylist(artifact);
    const workspaceManifestSource = readFileSync(resolve(ROOT, 'Cargo.toml'), 'utf8');
    const metadata = JSON.parse(execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--no-deps'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ));
    const result = validateArtifactAndMetadata(artifact, metadata, workspaceManifestSource);
    process.stdout.write(`[workspace-graph] PASS: ${result.members.length} members (${result.members.join(', ')}); ${result.plannedCrates} planned matrix rows\n`);
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
