// Snapback Contract static/native build preset.
//
// @ref LLP 0021#phase-3-package-the-build-and-launch-recipe - the Exact/Contract
//   Vite plugin ordering, route-registry preflights, native artifact target, and
//   Snapback admin base-path rewrite are product recipe, not admin-local lore.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class SnapbackContractBuildError extends Error {
  constructor(diagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'SnapbackContractBuildError';
    this.diagnostic = diagnostic;
  }
}

export async function buildSnapbackContractStaticApp({
  root,
  exactRoot = null,
  basePath = '/',
  entry = '/src/main.ts',
  outDir = 'dist',
  routeRegistry = 'src/app/routes.ts',
  staticPlatformTargets = ['mac'],
  logLevel = 'info',
  rewriteBasePath = true,
} = {}) {
  if (!root) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_BUILD_ROOT_MISSING',
      'Snapback Contract static build requires a project root.',
    );
  }

  const appRoot = resolve(root);
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedEntry = normalizeEntry(entry);
  const resolvedExactRoot = resolveExactRoot(exactRoot);
  const resolvedOutDir = resolve(appRoot, outDir);

  preflightAppFile({
    appRoot,
    relativePath: stripLeadingSlash(normalizedEntry),
    code: 'SNAPBACK_CAPABILITY_EXACT_ENTRY_MISSING',
    label: 'Contract static build entry',
  });
  preflightAppFile({
    appRoot,
    relativePath: stripLeadingSlash(routeRegistry),
    code: 'SNAPBACK_CAPABILITY_EXACT_ROUTE_REGISTRY_MISSING',
    label: 'Exact route registry',
  });

  const exactModules = preflightExactModules(resolvedExactRoot);
  const { build } = await import(exactModules.vite);
  const { exactVitePlugin } = await import(exactModules.exactVitePlugin);
  const { contractVitePlugin } = await import(exactModules.contractVitePlugin);
  const { workspaceAliases } = await import(exactModules.workspaceAliases);

  await build({
    appType: 'custom',
    configFile: false,
    logLevel,
    root: appRoot,
    base: normalizedBasePath,
    plugins: [
      exactVitePlugin({
        entry: normalizedEntry,
        apps: [{ basePath: normalizedBasePath, entry: normalizedEntry }],
        staticPlatformTargets,
      }),
      contractVitePlugin(),
    ],
    resolve: {
      alias: workspaceAliases,
      dedupe: ['react', 'react-dom'],
    },
    build: {
      target: 'es2022',
      outDir: resolvedOutDir,
      emptyOutDir: true,
      sourcemap: false,
    },
  });

  if (rewriteBasePath) {
    rewriteStaticBasePath({
      indexPath: resolve(resolvedOutDir, 'index.html'),
      basePath: normalizedBasePath,
    });
  }

  return {
    root: appRoot,
    exactRoot: resolvedExactRoot,
    outDir: resolvedOutDir,
    basePath: normalizedBasePath,
    staticPlatformTargets,
  };
}

export function rewriteStaticBasePath({ indexPath, basePath }) {
  const normalizedBasePath = normalizeBasePath(basePath);
  if (!existsSync(indexPath)) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_BUILD_OUTPUT_MISSING',
      'Snapback Contract static build did not emit index.html.',
      { path: indexPath },
    );
  }
  const rewritten = readFileSync(indexPath, 'utf8')
    .replaceAll('"/assets/', `"${normalizedBasePath}assets/`)
    .replaceAll('"./__exact/', `"${normalizedBasePath}__exact/`);
  writeFileSync(indexPath, rewritten);
}

export function snapbackContractBuildDiagnostic(code, message, details = {}) {
  return {
    code,
    severity: 'error',
    subsystem: 'contract-integration',
    message,
    details: {
      target_surface: 'static web/native Exact',
      ...details,
    },
  };
}

function resolveExactRoot(exactRoot) {
  return resolve(
    exactRoot ??
      process.env.SNAPBACK_EXACT_ROOT ??
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'exact'),
  );
}

function preflightAppFile({ appRoot, relativePath, code, label }) {
  const path = resolve(appRoot, relativePath);
  if (!existsSync(path)) {
    throw diagnosticError(code, `${label} is missing.`, {
      path,
      next_checks: [
        'keep the Contract static entry under a subdirectory such as src/main.ts',
        'keep the Exact route registry at src/app/routes.ts or pass routeRegistry explicitly',
      ],
    });
  }
}

function preflightExactModules(exactRoot) {
  const modules = {
    vite: resolve(exactRoot, 'node_modules/vite/dist/node/index.js'),
    exactVitePlugin: resolve(exactRoot, 'packages/exact-devtools/src/vite-plugin.ts'),
    contractVitePlugin: resolve(exactRoot, 'packages/exact-contract/src/vite-plugin.ts'),
    workspaceAliases: resolve(exactRoot, 'js/vite.shared.ts'),
  };
  const missing = Object.entries(modules).filter(([, path]) => !existsSync(path));
  if (missing.length > 0) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_MISSING',
      'Exact checkout with Contract, devtools, and Vite workspace support was not found.',
      {
        exact_root: exactRoot,
        missing: missing.map(([name, path]) => ({ name, path })),
        next_checks: [
          'set SNAPBACK_EXACT_ROOT to a local Exact checkout',
          'install Exact dependencies so node_modules/vite is present',
        ],
      },
    );
  }
  return modules;
}

function normalizeBasePath(basePath) {
  if (typeof basePath !== 'string' || basePath.length === 0 || !basePath.startsWith('/')) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_BASEPATH_INVALID',
      'Snapback Contract static build basePath must be an absolute path.',
      { basePath },
    );
  }
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
}

function normalizeEntry(entry) {
  if (typeof entry !== 'string' || entry.length === 0) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_ENTRY_MISSING',
      'Snapback Contract static build entry must be a non-empty path.',
      { entry },
    );
  }
  return entry.startsWith('/') ? entry : `/${entry}`;
}

function stripLeadingSlash(value) {
  return String(value).replace(/^\/+/, '');
}

function diagnosticError(code, message, details = {}) {
  return new SnapbackContractBuildError(snapbackContractBuildDiagnostic(code, message, details));
}
