// Exact package-export resolver for optional Contract integration.
//
// @ref LLP 0012#contract-artifacts - Contract integration should consume real
//   typed package surfaces where available, while core Snapback remains usable
//   without Exact installed.
// @ref LLP 0021#phase-3-package-the-build-and-launch-recipe - prefer installed
//   packages and explicit package-export probes over absolute source aliases.

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  isRealPathWithin,
  resolveContainedPackagePath,
  selectPackageExportTarget,
} from './package-export-path.mjs';

export const EXACT_CONTRACT_PACKAGE = '@exact/contract';
const EXACT_CONTRACT_PUBLISHED_PACKAGES = new Set([
  EXACT_CONTRACT_PACKAGE,
  '@ccheever/exact-contract',
]);

export async function importExactContractCompiler({ exactRoot = null } = {}) {
  return importExactContractExport('./compiler', { exactRoot });
}

export async function importExactContractRuntime({ exactRoot = null } = {}) {
  return importExactContractExport('./runtime', { exactRoot });
}

export async function importExactContractConformance({ exactRoot = null } = {}) {
  return importExactContractExport('./conformance', { exactRoot });
}

export async function importExactContractDeclaration({ exactRoot = null } = {}) {
  return importExactContractExport('./declaration', { exactRoot });
}

export async function importExactContractDiagnostics({ exactRoot = null } = {}) {
  return importExactContractExport('./diagnostics', { exactRoot });
}

export async function importExactContractExport(subpath, {
  exactRoot = null,
  resolveSpecifier = (specifier) => import.meta.resolve(specifier),
} = {}) {
  const specifier = exactContractSpecifier(subpath);
  // An explicit checkout is an override, not a fallback after arbitrary
  // installed-package execution. Resolve it directly and propagate every
  // import-time failure from the selected module.
  if (exactRoot) {
    const resolved = resolveExactContractExport(subpath, { exactRoot });
    if (!resolved) throw packageResolutionError(specifier, exactRoot, null);
    ensureSourceCheckoutSpecifierHook(resolved);
    return import(pathToFileURL(resolved.path).href);
  }

  let resolvedSpecifier;
  try {
    // Resolve and execute are intentionally separate: only failure to resolve
    // the optional package permits fallback. Once a package resolves, syntax,
    // dependency, and initialization errors belong to that package and must
    // surface unchanged.
    resolvedSpecifier = resolveSpecifier(specifier);
  } catch (error) {
    if (!isExactContractPackageNotFound(error)) throw error;
    const resolved = resolveExactContractExport(subpath, { exactRoot });
    if (!resolved) {
      throw packageResolutionError(specifier, exactRoot, error);
    }
    ensureSourceCheckoutSpecifierHook(resolved);
    return import(pathToFileURL(resolved.path).href);
  }
  const resolved = validateInstalledExactContractExport(subpath, resolvedSpecifier);
  if (!resolved) throw packageResolutionError(specifier, null, null);
  ensureSourceCheckoutSpecifierHook(resolved);
  return import(pathToFileURL(resolved.path).href);
}

function isExactContractPackageNotFound(error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') return false;
  const message = String(error?.message ?? '');
  return message.includes(`Cannot find package '${EXACT_CONTRACT_PACKAGE}'`)
    || message.includes(`Cannot find package "${EXACT_CONTRACT_PACKAGE}"`);
}

// Exact source checkouts ship TS-ESM sources whose relative specifiers use the
// `./signals.js` convention; Node's type stripping loads `.ts` files but does
// not remap `.js` specifiers back to them (ENG-23741). When the fallback
// resolves a `.ts`/`.tsx` entry (a source tree — registry dists ship `.js`,
// and a checkout's node_modules/@exact/* is a workspace symlink back into
// source), register a resolve hook scoped to that checkout which rewrites a
// relative `.js` specifier to its `.ts`/`.tsx` sibling — only when the `.js`
// file does not actually exist. Runtimes that already remap (bun) or predate
// registerHooks skip this.
const sourceCheckoutRootUrls = new Set();
let specifierHookRegistered = false;

function ensureSourceCheckoutSpecifierHook(resolved) {
  if (!/\.tsx?$/.test(resolved.path)) return;
  if (typeof nodeModule.registerHooks !== 'function') return;
  if (typeof Bun !== 'undefined') return;

  // Node loads modules at their realpath, so scope by the symlink-resolved
  // location. Workspace layout is <checkoutRoot>/packages/exact-contract;
  // scope the hook to the checkout root so sibling workspace deps
  // (@exact/core, facet-core, renderer, ...) resolved through the same source
  // tree are covered too. Fall back to the package root itself when the
  // layout is unfamiliar.
  let realPackageRoot;
  try {
    realPackageRoot = realpathSync(resolved.packageRoot);
  } catch {
    return;
  }
  const checkoutRoot = basename(dirname(realPackageRoot)) === 'packages'
    ? dirname(dirname(realPackageRoot))
    : realPackageRoot;
  const rootUrl = pathToFileURL(checkoutRoot).href.replace(/\/?$/, '/');
  if (sourceCheckoutRootUrls.has(rootUrl)) return;
  sourceCheckoutRootUrls.add(rootUrl);

  if (specifierHookRegistered) return;
  specifierHookRegistered = true;
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const parentURL = context?.parentURL;
      if (
        parentURL &&
        (specifier.startsWith('./') || specifier.startsWith('../')) &&
        specifier.endsWith('.js') &&
        isWithinSourceCheckout(parentURL)
      ) {
        const jsPath = fileURLToPath(new URL(specifier, parentURL));
        if (!existsSync(jsPath)) {
          const stem = specifier.slice(0, -'.js'.length);
          for (const extension of ['.ts', '.tsx']) {
            if (existsSync(`${jsPath.slice(0, -'.js'.length)}${extension}`)) {
              return nextResolve(`${stem}${extension}`, context);
            }
          }
        }
      }
      return nextResolve(specifier, context);
    },
    // Type stripping alone rejects non-erasable syntax (parameter properties,
    // enums) that the Exact source tree legally uses; full transform mode
    // handles it. Scoped to the registered checkout roots.
    load(url, context, nextLoad) {
      // Exact sources import .json without `with { type: 'json' }` (bundler
      // semantics); surface those as synthetic modules with a default export.
      if (/\.json$/.test(url) && isWithinSourceCheckout(url) && context?.importAttributes?.type !== 'json') {
        const parsed = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
        return {
          format: 'module',
          shortCircuit: true,
          source: `export default ${JSON.stringify(parsed)};`,
        };
      }
      if (/\.ts$/.test(url) && isWithinSourceCheckout(url) && typeof nodeModule.stripTypeScriptTypes === 'function') {
        const source = readFileSync(fileURLToPath(url), 'utf8');
        return {
          format: 'module',
          shortCircuit: true,
          source: nodeModule.stripTypeScriptTypes(source, {
            mode: 'transform',
            sourceUrl: url,
            sourceMap: true,
          }),
        };
      }
      return nextLoad(url, context);
    },
  });
}

function isWithinSourceCheckout(parentURL) {
  for (const rootUrl of sourceCheckoutRootUrls) {
    if (parentURL.startsWith(rootUrl)) return true;
  }
  return false;
}

export function resolveExactContractExport(subpath, { exactRoot = null } = {}) {
  const packageRoot = resolveExactContractPackageRoot({ exactRoot });
  if (!packageRoot) return null;

  return resolveExactContractExportFromPackageRoot(subpath, packageRoot);
}

function resolveExactContractExportFromPackageRoot(subpath, packageRoot) {
  const packageJsonPath = resolveContainedPackagePath(packageRoot, './package.json');
  if (!packageJsonPath) return null;
  const packageJson = readJson(packageJsonPath);
  if (!EXACT_CONTRACT_PUBLISHED_PACKAGES.has(packageJson?.name)) return null;

  const exportTarget = resolvePackageExport(packageJson, subpath);
  if (!exportTarget) return null;

  const resolvedPath = resolveContainedPackagePath(packageRoot, exportTarget, {
    probeFileCandidates: true,
  });
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

function validateInstalledExactContractExport(subpath, resolvedSpecifier) {
  let resolvedPath;
  try {
    const url = new URL(resolvedSpecifier);
    if (url.protocol !== 'file:') return null;
    resolvedPath = fileURLToPath(url);
  } catch {
    return null;
  }

  const packageRoot = findContainingExactPackageRoot(resolvedPath);
  if (!packageRoot) return null;
  const nodeModulesRoot = findContainingNodeModulesRoot(packageRoot);
  if (!nodeModulesRoot || !isRealPathWithin(nodeModulesRoot, packageRoot)) return null;
  const expected = resolveExactContractExportFromPackageRoot(subpath, packageRoot);
  if (!expected) return null;
  try {
    if (realpathSync(expected.path) !== realpathSync(resolvedPath)) return null;
  } catch {
    return null;
  }
  return expected;
}

function findContainingNodeModulesRoot(path) {
  let current = path;
  for (;;) {
    if (basename(current) === 'node_modules') return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findContainingExactPackageRoot(path) {
  let current = dirname(path);
  for (;;) {
    const lexicalManifestPath = join(current, 'package.json');
    if (hasFilesystemEntry(lexicalManifestPath)) {
      const packageJsonPath = resolveContainedPackagePath(current, './package.json');
      if (!packageJsonPath) return null;
      const packageJson = readJson(packageJsonPath);
      return EXACT_CONTRACT_PUBLISHED_PACKAGES.has(packageJson?.name) ? current : null;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function hasFilesystemEntry(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolveExactContractPackageRoot({ exactRoot }) {
  const roots = exactRoot ? [exactRoot] : [process.cwd()];

  for (const root of roots) {
    const nodeModulesRoot = join(root, 'node_modules');
    const installed = join(root, 'node_modules', '@exact', 'contract');
    if (
      resolveContainedPackagePath(installed, './package.json') &&
      isRealPathWithin(nodeModulesRoot, installed)
    ) {
      return installed;
    }
    const workspace = join(root, 'packages', 'exact-contract');
    if (resolveContainedPackagePath(workspace, './package.json')) {
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
  return selectPackageExportTarget(packageJson, subpath);
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
      exactRoot ? `Exact package/check-out root: ${exactRoot}` : 'Exact package/check-out root: <not configured>',
      'Install @exact/contract from the committed package aliases, or point SNAPBACK_EXACT_ROOT at a checkout for local Exact development.',
    ].join('\n'),
  );
  error.code = 'SNAPBACK_CAPABILITY_EXACT_PACKAGE_EXPORT_MISSING';
  error.cause = cause;
  return error;
}
