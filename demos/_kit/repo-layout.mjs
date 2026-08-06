// Repository/app layout resolution for the shared demo kit.
//
// The headless helper used to derive the repository root with a fixed number
// of parent traversals from the acceptance directory, which silently resolved
// `demos/` as the root for `demos/<bakeoff>/<arm>/tests/acceptance` layouts
// (issues/closed/20260805-headless-app-nested-demo-root.md; LLP 0176 A4).
// This module replaces depth assumptions with a marker walk: the repository
// root is the nearest ancestor carrying BOTH a `.git` entry (directory in a
// normal clone, file in a linked worktree) and this repository's root-only
// `ref-check` executable, and the app directory is the nearest ancestor of
// the acceptance directory that owns a `snapback/schema.mjs` backend source.
// Anything unresolvable refuses loudly, before a server can be launched from
// a plausible wrong directory.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both markers must be present: `.git` alone matches ANY repository the
// checkout is nested inside (or the demo's own sub-repo), and `ref-check`
// alone could be copied around. Together they identify the Snapback repo
// root, which is what the kit's relative imports and server launch require.
export const REPO_ROOT_MARKERS = ['.git', 'ref-check'];

// A backend lives at `<appDir>/snapback` and always carries its schema
// source, even before codegen has produced `generated/`.
const BACKEND_SOURCE_MARKER = join('snapback', 'schema.mjs');

function toDirectory(metaUrlOrPath) {
  if (typeof metaUrlOrPath !== 'string' || metaUrlOrPath.length === 0) {
    throw new TypeError('resolveHeadlessAppLayout requires import.meta.url or an absolute directory path');
  }
  if (metaUrlOrPath.startsWith('file:')) return dirname(fileURLToPath(metaUrlOrPath));
  if (!isAbsolute(metaUrlOrPath)) {
    throw new TypeError(`resolveHeadlessAppLayout requires a file: URL or absolute path, got ${metaUrlOrPath}`);
  }
  return metaUrlOrPath;
}

function* ancestors(startDir) {
  let current = resolve(startDir);
  while (true) {
    yield current;
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

// Nearest ancestor (including startDir) carrying every repo-root marker, or
// null when the walk exhausts the filesystem without finding one.
export function findRepoRoot(startDir) {
  for (const candidate of ancestors(startDir)) {
    if (REPO_ROOT_MARKERS.every((marker) => existsSync(join(candidate, marker)))) {
      return candidate;
    }
  }
  return null;
}

// Nearest ancestor (including startDir) that is inside ANY git checkout.
// Used by the EAS staging helper to prove a staged copy really escaped the
// monorepo (issues/closed/20260805-eas-nested-app-git-root-monorepo-archive.md).
export function findGitAncestor(startDir) {
  for (const candidate of ancestors(startDir)) {
    if (existsSync(join(candidate, '.git'))) return candidate;
  }
  return null;
}

function layoutError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

// Resolve { acceptanceDir, appDir, backendDir, generatedDir, repoRoot } for a
// headless acceptance module. `metaUrl` is the suite's import.meta.url (an
// absolute directory path is also accepted, which keeps the walk unit-testable
// without launching anything). The app directory is inferred as the nearest
// ancestor of the acceptance directory, strictly below the repository root,
// that owns a `snapback/schema.mjs` backend; pass `appDir` explicitly
// (absolute, or relative to the repository root) when a layout cannot be
// inferred that way.
export function resolveHeadlessAppLayout(metaUrl, { appDir = null } = {}) {
  const acceptanceDir = toDirectory(metaUrl);
  const repoRoot = findRepoRoot(acceptanceDir);
  if (repoRoot === null) {
    throw layoutError(
      'SNAPBACK_KIT_REPO_ROOT_NOT_FOUND',
      `no repository root found walking up from ${acceptanceDir}; expected an ancestor ` +
        `containing ${REPO_ROOT_MARKERS.join(' + ')} (the Snapback checkout root). ` +
        'Headless suites must run from inside the Snapback repository.',
    );
  }

  let resolvedAppDir = null;
  if (appDir !== null) {
    if (typeof appDir !== 'string' || appDir.length === 0) {
      throw new TypeError('appDir must be a non-empty path when provided');
    }
    resolvedAppDir = isAbsolute(appDir) ? resolve(appDir) : resolve(repoRoot, appDir);
  } else {
    for (const candidate of ancestors(acceptanceDir)) {
      if (candidate === repoRoot) break;
      if (existsSync(join(candidate, BACKEND_SOURCE_MARKER))) {
        resolvedAppDir = candidate;
        break;
      }
    }
    if (resolvedAppDir === null) {
      throw layoutError(
        'SNAPBACK_KIT_APP_DIR_NOT_FOUND',
        `no Snapback app directory found between ${acceptanceDir} and the repository root ` +
          `${repoRoot}; expected an ancestor containing ${BACKEND_SOURCE_MARKER}. ` +
          'Pass { appDir } to openHeadlessApp for layouts the walk cannot infer.',
      );
    }
  }

  const backendDir = join(resolvedAppDir, 'snapback');
  if (!existsSync(join(resolvedAppDir, BACKEND_SOURCE_MARKER))) {
    throw layoutError(
      'SNAPBACK_KIT_BACKEND_NOT_FOUND',
      `app directory ${resolvedAppDir} has no ${BACKEND_SOURCE_MARKER} backend ` +
        `(searched from ${acceptanceDir}; repository root ${repoRoot}). ` +
        'Refusing to start a server from a plausible wrong directory.',
    );
  }

  return {
    acceptanceDir,
    appDir: resolvedAppDir,
    backendDir,
    generatedDir: join(backendDir, 'generated'),
    repoRoot,
  };
}
