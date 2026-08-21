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
  ['snapback-harness', 'proof-harness', 7, ['snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-server']],
  ['snapback-tools', 'dev-tools', 7, ['snapback-activation', 'snapback-auth', 'snapback-cli', 'snapback-engine', 'snapback-kernel', 'snapback-runtime', 'snapback-server', 'snapback-services', 'snapback-sync', 'snapback-types']],
].map(([name, owner, rank, allowedWorkspaceDependencies]) => ({ name, owner, rank, allowedWorkspaceDependencies }));

const EXPECTED_CONFINEMENT = [
  ['axum', ['snapback-server']],
  ['celld-ltx', ['snapback-services']],
  ['clap', ['snapback-cli']],
  ['ibex-runtime', ['snapback-runtime']],
  ['rusqlite', ['snapback', 'snapback-harness', 'snapback-kernel', 'snapback-services']],
].map(([dependency, allowedMembers]) => ({ dependency, allowedMembers }));
const EXPECTED_GENERATED_SOURCE_HOMES = [];
const EXPECTED_MEMBERSHIP_ASSIGNMENTS = [];
const EXPECTED_WORKSPACE_MEMBERS = ['crates/*'];
const EXPECTED_WORKSPACE_DEFAULT_MEMBERS = ['crates/snapback'];
const EXPECTED_WORKSPACE_EXCLUDE = [
  'tools/agent-safe-baseline-worker',
  'vendor/ibex',
  'vendor/celld-ltx',
];
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
// A glob can import a macro, derive, or attribute without naming it in the
// engine source. Keep the compatibility globs that already compose reviewed
// lower-owner and local modules, but fail closed on every other root.
const SAFE_ENGINE_GLOB_IMPORTS = new Set([
  'capabilities::*',
  'config_types::*',
  'crate::host_ops_contract::*',
  'engine::*',
  'engine::generation_host::*',
  'generation_host::*',
  'host_glue::*',
  'snapback_kernel::assets::*',
  'snapback_kernel::assets_cut::*',
  'snapback_kernel::assets_store::*',
  'snapback_kernel::control_catalog::*',
  'snapback_kernel::instance_fork::*',
  'snapback_kernel::storage::jobs::*',
  'snapback_runtime::runtime::*',
  'snapback_services::assets::*',
  'snapback_services::assets_cut::*',
  'snapback_services::assets_store::*',
  'snapback_services::cron::*',
  'snapback_services::instance_fork::*',
  'snapback_services::telemetry::*',
  'snapback_types::instance_fork::*',
  'snapback_types::manifest::*',
  'snapback_types::push::*',
  'snapback_types::runtime::*',
  'super::*',
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
const CANONICAL_ENGINE_CRATE_PACKAGES = new Map([
  ['rusqlite', 'rusqlite'],
  ['schemars', 'schemars'],
  ['serde', 'serde'],
  ['serde_json', 'serde_json'],
  ['snapback_services', 'snapback-services'],
  ['tokio', 'tokio'],
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

// @ref LLP 0189#decision — analyzer retirement may not silently drop
// module-home coverage. Every Rust file inherits its workspace member's
// assigned owner; a named exception is the only other accepted home.
// @ref LLP 0276#crates--the-rust-workspace — committed generated Rust uses
// an exact, matrix-declared member source home rather than masquerading as
// authored source or temporary membership debt.
export function validateModuleMembership(
  artifact,
  rustPaths,
  pathExists = (path) => canonicalRegularFileExists(ROOT_REAL, path),
  today = new Date().toISOString().slice(0, 10),
) {
  sortedUniqueStrings(rustPaths, 'workspace Rust paths');
  const members = new Map((artifact.crates ?? []).map((entry) => [entry.name, entry]));
  const owners = new Set((artifact.crates ?? []).map((entry) => entry.owner));
  assert(rustPaths.length > 0, 'workspace Rust inventory must not be empty');

  const generatedSourceHomes = artifact.generatedSourceHomes;
  assert(Array.isArray(generatedSourceHomes), 'generatedSourceHomes must be an array');
  assert(
    JSON.stringify(generatedSourceHomes) === JSON.stringify(EXPECTED_GENERATED_SOURCE_HOMES),
    'generated source homes drifted from the LLP 0276 ownership projection',
  );
  for (const home of generatedSourceHomes) {
    validateCanonicalRepositoryPath(home.path, `${home.member} generated source home`);
    assert(members.has(home.member), `generated source home names unknown member ${home.member}`);
    assert(
      home.path === `crates/${home.member}/generated`,
      `${home.member} generated source home must be its canonical member-local generated directory`,
    );
  }

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
      assert(owners.has(assignment.assignedOwner), `${exception.name} contains unknown assignedOwner ${assignment.assignedOwner}`);
      assert(!exceptionAssignments.has(assignment.module), `membership exception assignment is duplicated: ${assignment.module}`);
      exceptionAssignments.set(assignment.module, {
        ...exception,
        assignedOwner: assignment.assignedOwner,
        used: false,
      });
    }
  }

  let moduleCount = 0;
  for (const rustPath of rustPaths) {
    validateCanonicalRepositoryPath(rustPath, 'workspace Rust path');
    const isModule = /^crates\/[a-z0-9-]+\/(?:src|tests|examples|benches)\/.+\.rs$/u.test(rustPath);
    const isBuildScript = /^crates\/[a-z0-9-]+\/build\.rs$/u.test(rustPath);
    const generatedHome = generatedSourceHomes.find(
      ({ path }) => rustPath.startsWith(`${path}/`) && rustPath.endsWith('.rs'),
    );
    assert(
      isModule || isBuildScript || generatedHome,
      `unmatched Rust file outside a member source home: ${rustPath}`,
    );
    assert(pathExists(rustPath), `assigned Rust file does not exist: ${rustPath}`);
    const actualMember = workspaceMemberForPath(rustPath);
    const member = members.get(actualMember);
    assert(member, `Rust file ${rustPath} is not inside an assigned workspace member`);
    assert(
      !generatedHome || actualMember === generatedHome.member,
      `generated Rust file ${rustPath} escapes its assigned member ${generatedHome?.member}`,
    );
    if (!isModule && !generatedHome) continue;
    moduleCount += 1;
    const exception = exceptionAssignments.get(rustPath);
    if (!exception) continue;
    assert(actualMember === exception.actualMember, `${exception.name} actualMember does not match ${rustPath}`);
    assert(member.owner !== exception.assignedOwner, `${exception.name} redundantly assigns ${rustPath} to its member owner`);
    exception.used = true;
    exceptionAssignments.set(rustPath, exception);
  }
  for (const [module, exception] of exceptionAssignments) {
    assert(exception.used, `${exception.name} does not match a workspace Rust module (${module})`);
  }
  const exceptionProjection = exceptions.map(({ name, actualMember, assignments }) => ({
    name,
    actualMember,
    assignments,
  }));
  assert(
    JSON.stringify(exceptionProjection) === JSON.stringify(EXPECTED_MEMBERSHIP_ASSIGNMENTS),
    'membership exception assignments drifted from the reviewed Phase 2 flip inventory',
  );
  return {
    moduleCount,
    exceptionCount: exceptionAssignments.size,
    generatedSourceHomeCount: generatedSourceHomes.length,
  };
}

export function rustSourceFiles(directory) {
  const directoryMetadata = lstatSync(directory);
  assert(
    directoryMetadata.isDirectory() && !directoryMetadata.isSymbolicLink(),
    `Rust source root must be a real directory: ${relative(ROOT, directory).split(sep).join('/')}`,
  );
  assert(
    realpathSync(directory) === resolve(directory),
    `Rust source root may not traverse a symlinked ancestor: ${relative(ROOT, directory).split(sep).join('/')}`,
  );
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    assert(!entry.isSymbolicLink(), `Rust source tree contains a symlink: ${relative(ROOT, path).split(sep).join('/')}`);
    if (entry.isDirectory()) return rustSourceFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.rs')) return [];
    return [{ path, source: readFileSync(path, 'utf8') }];
  });
}

// @ref LLP 0189#decision — retiring the module analyzer must preserve its
// fail-closed handling of explicit Rust module mounts. A #[path] target is
// code in the declaring crate even when its bytes live elsewhere, so every
// mount stays canonical, real, inventoried, and inside that same member.
export function validateWorkspacePathModules(
  files,
  pathExists = (path) => canonicalRegularFileExists(ROOT_REAL, path),
) {
  const inventoried = new Set(files.map(({ path }) => relative(ROOT, path).split(sep).join('/')));
  for (const file of files) {
    const declaringPath = relative(ROOT, file.path).split(sep).join('/');
    const declaringMember = workspaceMemberForPath(declaringPath);
    assert(declaringMember, `Rust source is not inside a workspace member: ${declaringPath}`);
    for (const attribute of rustAttributes(file.source)) {
      const head = /^#\s*!?\s*\[\s*([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)/su.exec(attribute)?.[1];
      if (head === 'cfg_attr' && /\bpath\s*=/su.test(attribute)) {
        assert(false, `workspace cfg_attr may not hide a #[path] module: ${declaringPath}`);
      }
      if (head !== 'path') continue;
      const match = /^#\s*!?\s*\[\s*path\s*=\s*"([^"\\]+)"\s*\]$/su.exec(attribute);
      assert(match, `workspace #[path] must use one simple relative file path: ${declaringPath}`);
      const modulePath = match[1];
      assert(
        modulePath.endsWith('.rs')
          && !posix.isAbsolute(modulePath)
          && posix.normalize(modulePath) === modulePath
          && modulePath !== '..'
          && !modulePath.startsWith('../'),
        `workspace #[path] is not a canonical in-member Rust path: ${declaringPath} -> ${modulePath}`,
      );
      const target = resolve(dirname(file.path), modulePath);
      const targetPath = relative(ROOT, target).split(sep).join('/');
      assert(
        workspaceMemberForPath(targetPath) === declaringMember
          && new RegExp(`^crates/${declaringMember}/(?:src|tests|examples|benches)/.+\\.rs$`, 'u').test(targetPath),
        `workspace #[path] escapes declaring member ${declaringMember}: ${declaringPath} -> ${targetPath}`,
      );
      assert(inventoried.has(targetPath), `workspace #[path] target is outside the Rust inventory: ${targetPath}`);
      assert(pathExists(targetPath), `workspace #[path] target is not a canonical regular file: ${targetPath}`);
    }
  }
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
      if (/(?:^|[,:{])\s*\*/u.test(useSpec)) {
        const normalizedUseSpec = useSpec.replace(/\s+/gu, '');
        assert(
          SAFE_ENGINE_GLOB_IMPORTS.has(normalizedUseSpec),
          `snapback-engine may not import an unreviewed glob ${normalizedUseSpec}: ${relative(ROOT, file.path).split(sep).join('/')}`,
        );
      }
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
      + String.raw`|mod|const|(?:(?:safe|unsafe)\s+)?static(?:\s+mut)?|macro_rules\s*!|macro)`;
    const pattern = new RegExp(
      String.raw`(?:^|[;{}(\[])\s*${visibility}${declaration}\s+(?:r#)?${entry.symbol}\b`,
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

function validateMemberTargets(member) {
  const memberRoot = `crates/${member.name}`;
  const manifestPath = `${memberRoot}/Cargo.toml`;
  assert(
    member.manifest_path === resolve(ROOT, manifestPath)
      && canonicalRegularFileExists(ROOT_REAL, manifestPath),
    `${member.name} package manifest must be the canonical physical ${manifestPath}`,
  );
  assert(Array.isArray(member.targets) && member.targets.length > 0, `${member.name} must declare at least one Rust target`);
  for (const target of member.targets) {
    assert(typeof target.src_path === 'string' && target.src_path.length > 0, `${member.name} target requires src_path`);
    const targetPath = relative(ROOT, target.src_path).split(sep).join('/');
    validateCanonicalRepositoryPath(targetPath, `${member.name} target src_path`);
    assert(target.src_path === resolve(ROOT, targetPath), `${member.name} target src_path must be canonical: ${target.src_path}`);
    assert(canonicalRegularFileExists(ROOT_REAL, targetPath), `${member.name} target src_path is not a canonical regular file: ${targetPath}`);
    const customBuild = target.kind?.includes('custom-build');
    const insideMember = customBuild
      ? targetPath === `${memberRoot}/build.rs`
      : new RegExp(`^${memberRoot}/(?:src|tests|examples|benches)/.+\\.rs$`, 'u').test(targetPath);
    assert(insideMember, `${member.name} target src_path escapes its assigned member home: ${targetPath}`);
  }
}

export function validateArtifactAndMetadata(artifact, metadata, workspaceManifestSource) {
  validateWorkspaceManifest(workspaceManifestSource);
  assert(artifact?.schemaVersion === 'snapback.allowed-dependencies.v1', 'matrix schemaVersion is invalid');
  assert(JSON.stringify(artifact.crates) === JSON.stringify(EXPECTED_CRATES), 'matrix crate rows drifted from LLP 0276');
  assert(JSON.stringify(artifact.externalConfinement) === JSON.stringify(EXPECTED_CONFINEMENT), 'external confinement drifted from LLP 0276');
  assert(
    JSON.stringify(artifact.generatedSourceHomes) === JSON.stringify(EXPECTED_GENERATED_SOURCE_HOMES),
    'generated source homes drifted from LLP 0276',
  );
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
    validateMemberTargets(member);
    const dependencies = new Set((member.dependencies ?? []).map((entry) => entry.name));
    if (member.name === 'snapback-engine') {
      const engineLib = resolve(ROOT, 'crates/snapback-engine/src/lib.rs');
      const libTargets = (member.targets ?? []).filter((target) => target.kind?.includes('lib'));
      const nonBuildTargets = (member.targets ?? [])
        .filter((target) => !target.kind?.includes('custom-build'));
      assert(
        libTargets.length === 1
          && nonBuildTargets.length === 1
          && nonBuildTargets[0] === libTargets[0]
          && JSON.stringify(libTargets[0].kind) === JSON.stringify(['lib'])
          && JSON.stringify(libTargets[0].crate_types) === JSON.stringify(['lib'])
          && libTargets[0].name === 'snapback_engine'
          && libTargets[0].src_path === engineLib
          && canonicalRegularFileExists(ROOT_REAL, 'crates/snapback-engine/src/lib.rs'),
        'snapback-engine must have only its canonical physical crates/snapback-engine/src/lib.rs Rust target',
      );
      for (const dependency of member.dependencies ?? []) {
        const binding = (dependency.rename ?? dependency.name).replaceAll('-', '_');
        assert(
          !TRUSTED_ENGINE_CRATE_BINDINGS.has(binding)
            || CANONICAL_ENGINE_CRATE_PACKAGES.get(binding) === dependency.name,
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
  assert(
    JSON.stringify([...memberNames].sort())
      === JSON.stringify(EXPECTED_CRATES.map((entry) => entry.name).sort()),
    `workspace member set must exactly match the ${EXPECTED_CRATES.length}-crate Phase 2 matrix`,
  );
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
    const rustFiles = rustSourceFiles(resolve(ROOT, 'crates'));
    validateWorkspacePathModules(rustFiles);
    const rustPaths = rustFiles
      .map(({ path }) => relative(ROOT, path).split(sep).join('/'))
      .sort();
    const membership = validateModuleMembership(artifact, rustPaths);
    validateEngineDefinitionDenylist(artifact);
    const workspaceManifestSource = readFileSync(resolve(ROOT, 'Cargo.toml'), 'utf8');
    const metadata = JSON.parse(execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--no-deps'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ));
    const result = validateArtifactAndMetadata(artifact, metadata, workspaceManifestSource);
    process.stdout.write(
      `[workspace-graph] PASS: ${result.members.length} members (${result.members.join(', ')}); `
        + `${result.plannedCrates} planned matrix rows; ${membership.moduleCount} Rust modules `
        + `across ${membership.generatedSourceHomeCount} committed generated source home(s) `
        + `(${membership.exceptionCount} named membership exceptions)\n`,
    );
  } catch (error) {
    process.stderr.write(`${DIAGNOSTIC}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
