// Snapback Contract static/native build preset.
//
// @ref LLP 0021#phase-3-package-the-build-and-launch-recipe - the Exact/Contract
//   Vite plugin ordering, route-registry preflights, native artifact target, and
//   Snapback admin base-path rewrite are product recipe, not admin-local lore.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_ADMIN_DEV_API_TARGET = 'http://127.0.0.1:4287';
const DEFAULT_ADMIN_DEV_HOST = '127.0.0.1';
const DEFAULT_ADMIN_DEV_PORT = 5173;
const ADMIN_API_PROXY_PATH = '/_snapback/api';
const WRONG_SERVER_SHAPE_PATHS = [
  '/__exact/platform-manifest.json',
  '/__exact/native/',
];

export class SnapbackContractBuildError extends Error {
  constructor(diagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'SnapbackContractBuildError';
    this.diagnostic = diagnostic;
  }
}

export async function buildSnapbackContractStaticApp({
  root,
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
  const resolvedOutDir = resolve(appRoot, outDir);
  const { entry: normalizedEntry, exactModules } =
    await contractViteBaseConfig({
      root: appRoot,
      entry,
      routeRegistry,
      exactPluginOptions: {
        apps: [{ basePath: normalizedBasePath, entry: normalizeEntry(entry) }],
        staticPlatformTargets,
      },
    });
  const { build } = await import(exactModules.vite);

  // The build goes through a real (generated) config file rather than an
  // inline config object. The static exporter's nested prerender server
  // reconstructs its config from the outer `configFile`; without one it drops
  // the plugin/options graph and can fail with nondeterministic "Failed to load
  // url … Does the file exist?" errors. Exact now resolves from app-local
  // packages, so the old two-repository fs.allow is intentionally absent.
  await withStaticBuildConfig({
    appRoot,
    exactModules,
    basePath: normalizedBasePath,
    entry: normalizeEntry(entry),
    routeRegistry: stripLeadingSlash(routeRegistry),
    staticPlatformTargets,
    outDir: resolvedOutDir,
  }, async (configFilePath) => {
    // @ref LLP 0017#static-bundling-and-the-native-shell — this generated
    // config is already executable ESM and Exact's nested prerender server
    // must be able to reopen its stable path. Vite's default bundle loader
    // executes plugins from an immediately deleted timestamp module; under
    // Bun/Rolldown that transient path can leak into Exact's resolved config.
    await build({ configFile: configFilePath, configLoader: 'native', logLevel });
  });

  if (rewriteBasePath) {
    rewriteStaticBasePath({
      indexPath: resolve(resolvedOutDir, 'index.html'),
      basePath: normalizedBasePath,
    });
  }

  return {
    root: appRoot,
    exactSource: 'installed-packages',
    outDir: resolvedOutDir,
    basePath: normalizedBasePath,
    staticPlatformTargets,
  };
}

// Give every outer build and nested prerender server its own immutable config
// path. The callback owns the complete lifetime: parallel builds cannot
// overwrite one another, and cleanup removes the containing temp directory.
export async function withStaticBuildConfig(options, run) {
  const configDir = mkdtempSync(join(tmpdir(), 'snapback-contract-static-'));
  const configFilePath = join(configDir, 'vite.config.mjs');
  try {
    writeFileSync(
      configFilePath,
      renderStaticBuildConfig(options),
    );
    return await run(configFilePath);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
}

export async function contractViteBaseConfig({
  root,
  entry = '/src/main.ts',
  routeRegistry = 'src/app/routes.ts',
  exactPluginOptions = {},
} = {}) {
  if (!root) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_BUILD_ROOT_MISSING',
      'Snapback Contract Vite config requires a project root.',
    );
  }

  const appRoot = resolve(root);
  const normalizedEntry = normalizeEntry(entry);
  const normalizedRouteRegistry = stripLeadingSlash(routeRegistry);

  preflightAppFile({
    appRoot,
    relativePath: stripLeadingSlash(normalizedEntry),
    code: 'SNAPBACK_CAPABILITY_EXACT_ENTRY_MISSING',
    label: 'Contract app entry',
  });
  preflightAppFile({
    appRoot,
    relativePath: normalizedRouteRegistry,
    code: 'SNAPBACK_CAPABILITY_EXACT_ROUTE_REGISTRY_MISSING',
    label: 'Exact route registry',
  });

  const exactModules = preflightExactModules(appRoot);
  const { exactVitePlugin } = await import(exactModules.exactVitePlugin);
  const { contractVitePlugin } = await import(exactModules.contractVitePlugin);

  return {
    root: appRoot,
    exactSource: 'installed-packages',
    entry: normalizedEntry,
    routeRegistry: normalizedRouteRegistry,
    exactModules,
    config: {
      appType: 'custom',
      configFile: false,
      root: appRoot,
      plugins: [
        exactVitePlugin({
          entry: normalizedEntry,
          routeRegistry: normalizedRouteRegistry,
          ...exactPluginOptions,
        }),
        contractVitePlugin(),
      ],
      resolve: {
        // ENG-22600: only dedupe react when the app root can actually resolve
        // it. Vite's dedupe forces bare `react` resolution to start from the
        // app root (tryNodeResolve: `if (dedupe.includes(pkgId)) basedir =
        // root`); admin-ui has no node_modules of its own, so that resolution
        // failed, the dep never registered with the dev optimizer, and the
        // browser was handed Exact's raw CJS react/index.js — which has no
        // ESM named exports ("does not provide an export named
        // 'isValidElement'”). Without dedupe the import resolves from the
        // installed Exact package importer and the optimizer prebundles it (verified:
        // imports rewrite to /node_modules/.vite/deps/react.js). Keep dedupe
        // when the root can resolve react, since that is the dual-React guard
        // for surfaces that install their own copy.
        // @ref LLP 0023#shared-vite-config-the-anti-drift-move — the preset
        // owns this seam for both build.sh and dev.mjs.
        dedupe: resolveRootResolvableDedupe(appRoot, ['react', 'react-dom']),
      },
    },
  };
}

export async function serveSnapbackContractApp({
  root,
  entry = '/src/main.ts',
  routeRegistry = 'src/app/routes.ts',
  apiTarget = null,
  apiProxyPath = ADMIN_API_PROXY_PATH,
  host = null,
  port = null,
  allowNonLoopbackHost = process.env.SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK === '1',
  logLevel = 'info',
} = {}) {
  const options = resolveSnapbackContractDevServerOptions({
    apiTarget,
    apiProxyPath,
    host,
    port,
    allowNonLoopbackHost,
  });
  const { config, exactModules, entry: normalizedEntry } =
    await contractViteBaseConfig({
      root,
      entry,
      routeRegistry,
      exactPluginOptions: {
        apps: [{ basePath: '/', entry: normalizeEntry(entry) }],
        agentReadiness: false,
        emitStaticPlatformManifest: false,
        staticPlatformTargets: false,
      },
    });
  const { createServer } = await import(exactModules.vite);

  printDevServerTargetNotes(options);
  const preflightDiagnostic = await preflightAdminApiTarget({
    apiTarget: options.apiTarget,
    apiProxyPath: options.apiProxyPath,
  });
  if (preflightDiagnostic) {
    console.warn(formatDiagnosticWarning(preflightDiagnostic));
  }

  const server = await createServer({
    ...config,
    logLevel,
    plugins: [
      snapbackContractDevDiagnosticsPlugin(),
      ...config.plugins,
      snapbackContractDevServerOptionsPlugin(options),
    ],
    server: {
      host: options.host,
      port: options.port,
      strictPort: false,
      proxy: {
        [options.apiProxyPath]: createAdminApiProxyConfig(options),
      },
    },
  });
  await server.listen();
  server.printUrls();
  console.log(`snapback admin dev: proxy ${options.apiProxyPath} -> ${options.apiTarget}`);

  return {
    server,
    root: config.root,
    exactSource: 'installed-packages',
    entry: normalizedEntry,
    apiTarget: options.apiTarget,
    apiTargetSource: options.apiTargetSource,
    apiProxyPath: options.apiProxyPath,
    host: options.host,
    port: options.port,
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
    .replaceAll('"/__exact/', `"${normalizedBasePath}__exact/`)
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

export function resolveSnapbackContractDevServerOptions({
  apiTarget = null,
  apiProxyPath = ADMIN_API_PROXY_PATH,
  host = null,
  port = null,
  allowNonLoopbackHost = false,
} = {}) {
  const resolvedApiTarget = normalizeHttpUrl(
    apiTarget ?? process.env.SNAPBACK_ADMIN_DEV_API ?? DEFAULT_ADMIN_DEV_API_TARGET,
    'SNAPBACK_ADMIN_DEV_API_INVALID',
    'SNAPBACK_ADMIN_DEV_API must be an absolute http(s) URL.',
  );
  const resolvedHost = host ?? process.env.SNAPBACK_ADMIN_DEV_HOST ?? DEFAULT_ADMIN_DEV_HOST;
  const hostIsLoopback = isLoopbackHost(resolvedHost);
  if (!hostIsLoopback && !allowNonLoopbackHost) {
    throw diagnosticError(
      'SNAPBACK_ADMIN_DEV_HOST_EXPOSED',
      'Admin dev proxy host is non-loopback and would expose privileged admin API routes.',
      {
        target_surface: 'admin Contract dev server',
        host: resolvedHost,
        next_checks: [
          'leave SNAPBACK_ADMIN_DEV_HOST unset for loopback-only development',
          'set SNAPBACK_ADMIN_DEV_ALLOW_NON_LOOPBACK=1 only when you intend to expose the proxy',
        ],
      },
    );
  }
  return {
    apiTarget: resolvedApiTarget,
    apiTargetSource: apiTarget || process.env.SNAPBACK_ADMIN_DEV_API ? 'explicit' : 'default-pinned-port',
    apiProxyPath: normalizeProxyPath(apiProxyPath),
    host: resolvedHost,
    hostIsLoopback,
    port: normalizePort(port ?? process.env.SNAPBACK_ADMIN_DEV_PORT ?? DEFAULT_ADMIN_DEV_PORT),
    allowNonLoopbackHost,
  };
}

export function createSnapbackAdminDevApiUnreachableDiagnostic({
  apiTarget,
  requestPath = ADMIN_API_PROXY_PATH,
  error = null,
} = {}) {
  const cause = error instanceof Error ? error.message : error ? String(error) : null;
  return {
    code: 'SNAPBACK_ADMIN_DEV_API_UNREACHABLE',
    severity: 'error',
    subsystem: 'contract-integration',
    message: 'Admin dev proxy could not reach the Snapback API target.',
    details: {
      target_surface: 'admin Contract dev server',
      api_target: apiTarget,
      request_path: requestPath,
      cause,
      next_checks: [
        'start Snapback in another terminal, for example: snapback start --memory --port 4287',
        'set SNAPBACK_ADMIN_DEV_API to the actual printed Snapback server URL if it auto-scanned to another port',
      ],
    },
  };
}

export function createSnapbackWrongServerShapeDiagnostic({ requestPath } = {}) {
  return {
    code: 'SNAPBACK_CAPABILITY_EXACT_NATIVE_ARTIFACTS_UNAVAILABLE',
    severity: 'error',
    subsystem: 'contract-integration',
    message: 'The Snapback admin dev server is browser-only and does not serve static Exact native artifacts.',
    details: {
      target_surface: 'admin Contract dev server',
      request_path: requestPath,
      next_checks: [
        'run admin-ui/build.sh and serve the generated dist with SNAPBACK_ADMIN_DIST for native Exact shell loading',
        'open the Vite dev server in a browser for admin UI hot-update work',
      ],
    },
  };
}

// ENG-22600: see the `resolve.dedupe` comment in contractViteBaseConfig.
// Dedupe entries are only safe when node resolution from the app root can
// find the package; otherwise they silently disable Vite's dep optimizer for
// that package and dev serve ships raw CJS to the browser. Exported for
// build-preset.test.mjs (drop-out and re-arm coverage).
export function resolveRootResolvableDedupe(appRoot, packageNames) {
  return packageNames.filter((name) => findInstalledPackageRoot(appRoot, name) !== null);
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

function preflightExactModules(appRoot) {
  const specifiers = {
    vite: 'vite',
    exactVitePlugin: '@exact/devtools/vite-plugin',
    contractVitePlugin: '@exact/contract/vite-plugin',
  };
  const modules = {};
  const missing = [];
  for (const [name, specifier] of Object.entries(specifiers)) {
    const resolved = resolveInstalledPackageSpecifier(appRoot, specifier);
    if (resolved) {
      modules[name] = resolved;
    } else {
      missing.push({ name, specifier });
    }
  }
  if (missing.length > 0) {
    throw diagnosticError(
      'SNAPBACK_CAPABILITY_EXACT_MISSING',
      'Installed Exact Contract/devtools packages and Vite were not found for this app.',
      {
        app_root: appRoot,
        missing,
        next_checks: [
          'run bun install in the app directory using its committed lockfile',
          'verify package.json aliases @exact/* to the published @ccheever/exact-* versions',
        ],
      },
    );
  }
  return modules;
}

/**
 * Resolve an installed package export from the app's node_modules hierarchy.
 * Bun's createRequire(...).resolve() can use the process workspace instead of
 * the synthetic app base, and npm aliases intentionally make package.json.name
 * differ from the import key. Walking the installation key explicitly keeps
 * admin builds package-only and deterministic (ENG-22564).
 */
export function resolveInstalledPackageSpecifier(appRoot, specifier) {
  const parsed = parsePackageSpecifier(specifier);
  if (!parsed) {
    return null;
  }
  const packageRoot = findInstalledPackageRoot(appRoot, parsed.packageName);
  if (!packageRoot) {
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const target = resolvePackageExportTarget(manifest, parsed.subpath);
  if (!target) {
    return null;
  }
  const path = resolve(packageRoot, target);
  return existsSync(path) ? path : null;
}

function findInstalledPackageRoot(appRoot, packageName) {
  let current = resolve(appRoot);
  while (true) {
    const packageRoot = join(current, 'node_modules', ...packageName.split('/'));
    if (existsSync(join(packageRoot, 'package.json'))) {
      return packageRoot;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function parsePackageSpecifier(specifier) {
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (parts.length < 2) {
      return null;
    }
    return {
      packageName: `${parts[0]}/${parts[1]}`,
      subpath: parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.',
    };
  }
  if (!parts[0]) {
    return null;
  }
  return {
    packageName: parts[0],
    subpath: parts.length > 1 ? `./${parts.slice(1).join('/')}` : '.',
  };
}

function resolvePackageExportTarget(manifest, subpath) {
  const entry = manifest.exports?.[subpath];
  if (typeof entry === 'string') {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    return entry.import ?? entry.default ?? null;
  }
  if (subpath === '.') {
    return manifest.module ?? manifest.main ?? null;
  }
  return null;
}

// The generated static-build config file (see buildSnapbackContractStaticApp).
// Everything the nested prerender server needs must live here, because that
// server is created from this file alone: installed package plugin paths and
// the app-root dedupe decision must be carried through explicitly.
function renderStaticBuildConfig({
  appRoot,
  exactModules,
  basePath,
  entry,
  routeRegistry,
  staticPlatformTargets,
  outDir,
}) {
  const pluginOptions = {
    entry,
    routeRegistry,
    apps: [{ basePath, entry }],
    staticPlatformTargets,
  };
  const dedupe = resolveRootResolvableDedupe(appRoot, ['react', 'react-dom']);
  return `// Generated by snapback-contract/build-preset.mjs for one static build. Deleted after.
import { exactVitePlugin } from ${JSON.stringify(exactModules.exactVitePlugin)};
import { contractVitePlugin } from ${JSON.stringify(exactModules.contractVitePlugin)};

export default {
  appType: 'custom',
  root: ${JSON.stringify(appRoot)},
  // Keep Vite's own module ids app-root-relative for Exact native startup/HBC.
  // Browser-serving paths are patched into index.html after the build.
  base: '/',
  plugins: [
    exactVitePlugin(${JSON.stringify(pluginOptions)}),
    contractVitePlugin(),
  ],
  resolve: {
    dedupe: ${JSON.stringify(dedupe)},
  },
  build: {
    target: 'es2022',
    outDir: ${JSON.stringify(outDir)},
    emptyOutDir: true,
    sourcemap: false,
  },
};
`;
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

function normalizeHttpUrl(value, code, message) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`unsupported protocol ${url.protocol}`);
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    throw diagnosticError(code, message, { value });
  }
}

function normalizeProxyPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    throw diagnosticError(
      'SNAPBACK_ADMIN_DEV_PROXY_PATH_INVALID',
      'Admin dev proxy path must start with a slash.',
      { target_surface: 'admin Contract dev server', value },
    );
  }
  return value.replace(/\/+$/, '') || '/';
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw diagnosticError(
      'SNAPBACK_ADMIN_DEV_PORT_INVALID',
      'SNAPBACK_ADMIN_DEV_PORT must be an integer TCP port.',
      { target_surface: 'admin Contract dev server', value },
    );
  }
  return port;
}

function isLoopbackHost(host) {
  return host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]';
}

function printDevServerTargetNotes(options) {
  if (options.apiTargetSource === 'default-pinned-port') {
    console.warn(
      'snapback admin dev: assuming API target http://127.0.0.1:4287. ' +
      'Pin Snapback with --port 4287 or set SNAPBACK_ADMIN_DEV_API to the printed server URL.',
    );
  }
  if (!options.hostIsLoopback) {
    console.warn(
      `snapback admin dev: exposing privileged admin API proxy on ${options.host}; ` +
      'only do this on a trusted network.',
    );
  }
}

async function preflightAdminApiTarget({ apiTarget, apiProxyPath }) {
  if (typeof fetch !== 'function') {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${apiTarget}${apiProxyPath}/inspect`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return createSnapbackAdminDevApiUnreachableDiagnostic({
        apiTarget,
        requestPath: `${apiProxyPath}/inspect`,
        error: `HTTP ${response.status}`,
      });
    }
    return null;
  } catch (error) {
    return createSnapbackAdminDevApiUnreachableDiagnostic({
      apiTarget,
      requestPath: `${apiProxyPath}/inspect`,
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function createAdminApiProxyConfig(options) {
  return {
    target: options.apiTarget,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('error', (error, req, res) => {
        const diagnostic = createSnapbackAdminDevApiUnreachableDiagnostic({
          apiTarget: options.apiTarget,
          requestPath: req?.url ?? options.apiProxyPath,
          error,
        });
        sendJsonResponse(res, 502, { diagnostic });
      });
    },
  };
}

function snapbackContractDevDiagnosticsPlugin() {
  return {
    name: 'snapback-contract-dev-diagnostics',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = requestPathname(req.url);
        if (!isWrongServerShapePath(requestPath)) {
          next();
          return;
        }
        sendJsonResponse(res, 404, {
          diagnostic: createSnapbackWrongServerShapeDiagnostic({ requestPath }),
        });
      });
    },
  };
}

function snapbackContractDevServerOptionsPlugin(options) {
  return {
    name: 'snapback-contract-dev-server-options',
    enforce: 'post',
    config() {
      return {
        server: {
          host: options.host,
          port: options.port,
          strictPort: false,
          proxy: {
            [options.apiProxyPath]: createAdminApiProxyConfig(options),
          },
        },
      };
    },
  };
}

function requestPathname(url) {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').pathname;
  } catch {
    return '/';
  }
}

function isWrongServerShapePath(pathname) {
  return WRONG_SERVER_SHAPE_PATHS.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix,
  );
}

function sendJsonResponse(res, statusCode, payload) {
  if (!res || typeof res.writeHead !== 'function') {
    return;
  }
  if (!res.headersSent) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
  }
  res.end(JSON.stringify(payload));
}

function formatDiagnosticWarning(diagnostic) {
  return `${diagnostic.code}: ${diagnostic.message}\n${JSON.stringify(diagnostic.details, null, 2)}`;
}
