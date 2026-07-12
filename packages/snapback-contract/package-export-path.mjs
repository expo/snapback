// Strict filesystem projection for package.json export targets.
//
// @ref LLP 0021#phase-3-package-the-build-and-launch-recipe — Exact imports
//   execute only the selected package's declared, contained export surface.
//
// Package exports are URLs relative to the package root, not arbitrary paths.
// These helpers keep capability probes and direct checkout imports aligned with
// Node's containment boundary: reject malformed/traversing targets lexically,
// then reject a final file whose symlink-resolved identity leaves the package.

import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs'];
const NODE_ESM_EXPORT_CONDITIONS = new Set([
  'node-addons',
  'node',
  'module-sync',
  'import',
  'default',
]);

export function selectPackageExportTarget(packageJson, subpath) {
  const normalized = subpath === './' ? '.' : subpath;
  const exportsField = packageJson?.exports;
  if (exportsField === undefined || exportsField === null) {
    if (normalized !== '.' || typeof packageJson?.main !== 'string') return null;
    // Legacy `main` paths are package-relative without requiring the modern
    // exports field's leading `./`; normalize before the shared strict check.
    return packageJson.main.startsWith('./') ? packageJson.main : `./${packageJson.main}`;
  }

  let entry = null;
  if (typeof exportsField === 'string' || Array.isArray(exportsField)) {
    if (normalized === '.') entry = exportsField;
  } else if (typeof exportsField === 'object') {
    const keys = Object.keys(exportsField);
    const hasSubpaths = keys.some((key) => key.startsWith('.'));
    // Node rejects mixing subpath and condition keys at one object level.
    if (hasSubpaths && keys.some((key) => !key.startsWith('.'))) return null;
    entry = hasSubpaths ? exportsField[normalized] : normalized === '.' ? exportsField : null;
  }
  return selectConditionalTarget(entry);
}

function selectConditionalTarget(entry) {
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry)) {
    for (const candidate of entry) {
      const target = selectConditionalTarget(candidate);
      if (target !== null) return target;
    }
    return null;
  }
  if (entry && typeof entry === 'object') {
    // Conditional exports are selected in author order, not by a hard-coded
    // preference for `import`. Model Node's default ESM condition set so a
    // leading `node` or `default` target agrees with import.meta.resolve().
    for (const [condition, candidate] of Object.entries(entry)) {
      if (!NODE_ESM_EXPORT_CONDITIONS.has(condition)) continue;
      const target = selectConditionalTarget(candidate);
      if (target !== null) return target;
    }
  }
  return null;
}

export function isValidPackageExportTarget(target) {
  if (typeof target !== 'string' || !target.startsWith('./') || target.length <= 2) {
    return false;
  }
  // Backslashes are separators on Windows but ordinary characters on Unix;
  // accepting them would make the same manifest platform-dependent.
  if (target.includes('\\') || target.includes('\0') || /[?#*]/.test(target)) {
    return false;
  }

  const segments = target.slice(2).split('/');
  if (segments.some((segment) => segment.length === 0)) return false;
  for (const segment of segments) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0') ||
      decoded.toLowerCase() === 'node_modules' ||
      /^[A-Za-z]:$/.test(decoded)
    ) {
      return false;
    }
  }
  return true;
}

export function resolveContainedPackagePath(packageRoot, target, {
  probeFileCandidates = false,
} = {}) {
  if (!isValidPackageExportTarget(target)) return null;

  const lexicalRoot = resolve(packageRoot);
  const decodedSegments = target.slice(2).split('/').map((segment) => decodeURIComponent(segment));
  const basePath = resolve(lexicalRoot, ...decodedSegments);
  if (!isWithin(lexicalRoot, basePath)) return null;

  const candidates = [basePath];
  if (probeFileCandidates) {
    for (const extension of FILE_EXTENSIONS) candidates.push(`${basePath}${extension}`);
    for (const fileName of INDEX_FILES) candidates.push(resolve(basePath, fileName));
  }

  let realRoot;
  try {
    realRoot = realpathSync(lexicalRoot);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    if (!isWithin(lexicalRoot, candidate) || !existsSync(candidate)) continue;
    try {
      if (!statSync(candidate).isFile()) continue;
      const realCandidate = realpathSync(candidate);
      if (isWithin(realRoot, realCandidate)) return candidate;
    } catch {
      // A disappearing or unreadable candidate is not an available export.
    }
  }
  return null;
}

export function isRealPathWithin(root, candidate) {
  try {
    return isWithin(realpathSync(root), realpathSync(candidate));
  } catch {
    return false;
  }
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}
