// Exact package-export resolver for optional Contract integration.
//
// @ref LLP 0012#contract-artifacts - Contract integration should consume real
//   typed package surfaces where available, while core Snapback remains usable
//   without Exact installed.
// @ref LLP 0021#phase-3-package-the-build-and-launch-recipe - prefer installed
//   packages and explicit package-export probes over absolute source aliases.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXACT_CONTRACT_PACKAGE = '@exact/contract';

export async function importExactContractCompiler({ exactRoot = null } = {}) {
  return importExactContractExport('./compiler', { exactRoot });
}

export async function importExactContractRuntime({ exactRoot = null } = {}) {
  return importExactContractExport('./runtime', { exactRoot });
}

export async function importExactContractConformance({ exactRoot = null } = {}) {
  return importExactContractExport('./conformance', { exactRoot });
}

export async function importExactContractExport(subpath, { exactRoot = null } = {}) {
  const specifier = exactContractSpecifier(subpath);
  try {
    return await import(specifier);
  } catch (error) {
    const resolved = resolveExactContractExport(subpath, { exactRoot });
    if (!resolved) {
      throw packageResolutionError(specifier, exactRoot, error);
    }
    return import(pathToFileURL(resolved.path).href);
  }
}

export function resolveExactContractExport(subpath, { exactRoot = null } = {}) {
  const packageRoot = resolveExactContractPackageRoot({ exactRoot });
  if (!packageRoot) return null;

  const packageJsonPath = join(packageRoot, 'package.json');
  const packageJson = readJson(packageJsonPath);
  if (packageJson?.name !== EXACT_CONTRACT_PACKAGE) return null;

  const exportTarget = resolvePackageExport(packageJson, subpath);
  if (!exportTarget) return null;

  const resolvedPath = resolveFileCandidate(resolve(packageRoot, exportTarget));
  return resolvedPath
    ? {
        packageName: EXACT_CONTRACT_PACKAGE,
        packageRoot,
        packageJsonPath,
        subpath,
        specifier: exactContractSpecifier(subpath),
        path: resolvedPath,
      }
    : null;
}

function resolveExactContractPackageRoot({ exactRoot }) {
  const roots = [
    process.cwd(),
    exactRoot,
  ].filter(Boolean);

  for (const root of roots) {
    const installed = join(root, 'node_modules', '@exact', 'contract');
    if (existsSync(join(installed, 'package.json'))) {
      return installed;
    }
    const workspace = join(root, 'packages', 'exact-contract');
    if (existsSync(join(workspace, 'package.json'))) {
      return workspace;
    }
  }
  return null;
}

function exactContractSpecifier(subpath) {
  if (subpath === '.' || subpath === './') return EXACT_CONTRACT_PACKAGE;
  return `${EXACT_CONTRACT_PACKAGE}/${subpath.replace(/^\.\//, '')}`;
}

function resolvePackageExport(packageJson, subpath) {
  const normalized = subpath === './' ? '.' : subpath;
  const exportsField = packageJson?.exports;
  if (!exportsField || typeof exportsField !== 'object') {
    return normalized === '.' && typeof packageJson?.main === 'string' ? packageJson.main : null;
  }

  const entry = exportsField[normalized];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    if (typeof entry.import === 'string') return entry.import;
    if (typeof entry.default === 'string') return entry.default;
  }
  return null;
}

function resolveFileCandidate(basePath) {
  if (existsSync(basePath)) return basePath;
  for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.cjs']) {
    const candidate = `${basePath}${extension}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const fileName of ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'index.cjs']) {
    const candidate = join(basePath, fileName);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function packageResolutionError(specifier, exactRoot, cause) {
  const error = new Error(
    [
      `Unable to resolve ${specifier} from installed packages or Exact package exports.`,
      exactRoot ? `Exact root: ${exactRoot}` : 'Exact root: <not configured>',
      'Install @exact/contract or point SNAPBACK_EXACT_ROOT at a checkout that exports the requested module.',
    ].join('\n'),
  );
  error.code = 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING';
  error.cause = cause;
  return error;
}
