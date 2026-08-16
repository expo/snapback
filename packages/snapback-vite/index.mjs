// @expo/snapback-vite — the LLP 0030 MVP managed-dev Vite plugin.
//
// One Vite dev command runs an app surface against a local Snapback backend:
// the plugin consumes the `snapback start --ready-file` readiness handshake,
// owns a mode-aware lifecycle (off / external / attach / managed / auto),
// relays only allowlisted app routes at `/__snapback`, and reports every
// lifecycle or proxy failure as a structured JSON diagnostic. Codegen, watch,
// and hot push stay with the `snapback` CLI (LLP 0041's boundary); this
// plugin loads already-generated artifacts at bring-up and nothing more.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diagnosticError,
  resolveGeneratedArtifact,
  verifyGeneratedGraph,
} from '@expo/snapback-cli';

import { APP_ROUTE_ALLOWLIST, matchAppRoute } from './allowlist.mjs';
import {
  matchManifestRoute,
  snapbackChannelA,
} from './channel-a.mjs';
import {
  htmlSafeJsonSerialize,
  serializeBootPayload,
} from './rqs-serializer.mjs';
import {
  LIFECYCLE_MODES,
  createDiagnosticsChannel,
  createSnapbackViteLifecycle,
} from './lifecycle.mjs';
import { createSnapbackProxy, refusalDiagnostic, unreachableDiagnostic } from './proxy.mjs';

export {
  APP_ROUTE_ALLOWLIST,
  LIFECYCLE_MODES,
  createDiagnosticsChannel,
  createSnapbackProxy,
  createSnapbackViteLifecycle,
  htmlSafeJsonSerialize,
  matchAppRoute,
  matchManifestRoute,
  refusalDiagnostic,
  serializeBootPayload,
  snapbackChannelA,
  unreachableDiagnostic,
};

export const VIRTUAL_MODULE_ID = 'virtual:snapback/dev';
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
// @ref LLP 0262#d2-carriers-per-shipped-topology — custody sidecars must be
// inaccessible to both Vite filesystem serving and its public directory.
const DEV_IDENTITY_DENY_GLOB = '**/*.dev-identity';

function isWithinDirectory(directory, path) {
  const nested = relative(resolve(directory), resolve(path));
  return nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested));
}

function configuredDevIdentityCarriers({ mode, projectRoot, serverOptions, env }) {
  const carriers = [];
  if (mode === 'managed' || mode === 'auto') {
    const stateRoot = join(projectRoot, '.snapback');
    const database = resolve(projectRoot, serverOptions.db ?? serverOptions.database ?? join(stateRoot, 'dev.sqlite3'));
    carriers.push(`${database}.dev-identity`);
  }
  const handoff = env.SNAPBACK_DEV_IDENTITY_FILE;
  if (mode !== 'managed' && typeof handoff === 'string' && handoff.length > 0) {
    carriers.push(resolve(projectRoot, handoff));
  }
  return carriers;
}

function normalizeRoute(route) {
  const value = route ?? '/__snapback';
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || value.endsWith('/')) {
    throw diagnosticError('SNAPBACK_DEV_PROXY_PATH_INVALID', 'route must be an absolute prefix such as /__snapback', {
      route: value,
    });
  }
  return value;
}

// Resolve materialized generated imports through the manifest-bound cache.
// Source files keep the ergonomic `snapback/generated/api.mjs` spelling while
// Vite consumes only bytes whose digest belongs to the complete inputsHash.
//
// @ref LLP 0010#generated-artifacts — bundlers must not trust a stale
// materialized projection when the review manifest identifies an immutable
// complete-input graph.
function resolvedGeneratedSpecifier(artifactPath, resolvedArtifact, suffix) {
  // Vite 8/Rolldown classifies queried JSON as JavaScript. The immutable
  // review-cache directory already content-addresses these exact bytes, so
  // the generator's Node cache-busting identity is redundant after this
  // adapter has resolved the materialization into that directory. Preserve
  // every semantic query (for example ?raw); strip only the generated
  // AppDescriptor identity form.
  // @ref LLP 0010#generated-artifacts — bundlers consume verified graph bytes
  // without weakening the generator's ordinary Node cache boundary.
  if (
    artifactPath.endsWith('.json')
    && /^\?identity=[0-9a-f]{64}$/u.test(suffix)
  ) return resolvedArtifact;
  return `${resolvedArtifact}${suffix}`;
}

const GENERATED_IMPORT_EXTENSIONS = Object.freeze([
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
]);

function resolveManifestGeneratedArtifact(generatedRoot, artifactPath) {
  try {
    return {
      artifactPath,
      resolvedArtifact: resolveGeneratedArtifact(generatedRoot, artifactPath),
    };
  } catch (error) {
    if (error?.code !== 'SNAPBACK_CODEGEN_ARTIFACT_NOT_IN_MANIFEST') throw error;
    for (const extension of GENERATED_IMPORT_EXTENSIONS) {
      const candidate = `${artifactPath}${extension}`;
      try {
        return {
          artifactPath: candidate,
          resolvedArtifact: resolveGeneratedArtifact(generatedRoot, candidate),
        };
      } catch (candidateError) {
        if (candidateError?.code !== 'SNAPBACK_CODEGEN_ARTIFACT_NOT_IN_MANIFEST') {
          throw candidateError;
        }
      }
    }
    throw error;
  }
}

export function resolveGeneratedImport(id, importer, verifiedGraphRoots = null) {
  if (
    typeof id !== 'string'
    || typeof importer !== 'string'
    || id.startsWith('\0')
    || (!id.startsWith('.') && !isAbsolute(id))
  ) {
    return null;
  }
  const suffixAt = id.search(/[?#]/u);
  const source = suffixAt === -1 ? id : id.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : id.slice(suffixAt);
  const importerPath = importer.startsWith('file:')
    ? fileURLToPath(importer)
    : importer.split(/[?#]/u, 1)[0];
  const requested = isAbsolute(source)
    ? resolve(source)
    : resolve(dirname(importerPath), source);
  if (verifiedGraphRoots instanceof Map) {
    for (const [graphRoot, materializedRoot] of verifiedGraphRoots) {
      const importerRelative = relative(graphRoot, importerPath);
      const artifactPath = relative(graphRoot, requested).split(sep).join('/');
      if (
        importerRelative !== '..'
        && !importerRelative.startsWith(`..${sep}`)
        && artifactPath !== '..'
        && !artifactPath.startsWith('../')
      ) {
        const resolved = resolveManifestGeneratedArtifact(materializedRoot, artifactPath);
        return resolvedGeneratedSpecifier(resolved.artifactPath, resolved.resolvedArtifact, suffix);
      }
    }
  }
  let generatedRoot = dirname(requested);
  while (true) {
    if (
      /^generated(?:-[a-z0-9-]+)?$/u.test(generatedRoot.split(sep).at(-1) ?? '')
      && existsSync(resolve(generatedRoot, 'artifacts.json'))
    ) {
      const artifactPath = relative(generatedRoot, requested).split(sep).join('/');
      const resolved = resolveManifestGeneratedArtifact(generatedRoot, artifactPath);
      if (verifiedGraphRoots instanceof Map) {
        const graphRoot = resolved.artifactPath.split('/').reduce(
          (root) => dirname(root),
          resolved.resolvedArtifact,
        );
        verifiedGraphRoots.set(graphRoot, generatedRoot);
      }
      return resolvedGeneratedSpecifier(resolved.artifactPath, resolved.resolvedArtifact, suffix);
    }
    const parent = dirname(generatedRoot);
    if (parent === generatedRoot) return null;
    generatedRoot = parent;
  }
}

// The virtual module ships only the relative base path and sanitized state.
//
// @ref LLP 0030#generated-app-facts — no private loopback URL, admin token,
//   token-file path, or command line may reach browser-visible module code;
//   the browser client uses the relative base path, never the backend origin.
export function renderVirtualModule({
  base,
  state,
  supervisorGeneration = 'vite-relay:standalone',
}) {
  const devState = {
    mode: state?.mode ?? 'off',
    shape: state?.shape ?? null,
    ready: state?.ready === true,
    basePath: base,
  };
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  return '// Generated by @expo/snapback-vite. Dev-only state: no secrets, no backend origins.\n'
    + `export const snapbackBasePath = ${JSON.stringify(base)};\n`
    + `export const snapbackDevState = Object.freeze(${JSON.stringify(devState)});\n`
    + 'const deepFreeze = (value) => { for (const child of Object.values(value ?? {})) { if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child); } return Object.freeze(value); };\n'
    + 'export function createSnapbackDevAppBinding(app) {\n'
    + '  if (!snapbackDevState.ready || app?.format !== "snapback.app.v1") throw new Error("SNAPBACK_DEV_APP_BINDING_UNAVAILABLE: the managed Vite relay and a generated app are required");\n'
    + '  const offered = new Set(app.capabilities?.required ?? []);\n'
    + '  if (app.authBootstrap?.entryMechanisms?.includes("password-v1")) offered.add("auth.passwords");\n'
    + '  return deepFreeze({ format: "snapback.app-binding.v1", source: "supervised-dev", descriptorIdentity: app.identity.descriptor, target: { app: app.identity.app, schema: app.identity.schema, functions: app.identity.functions, origin: snapbackBasePath, routing: "loopback" }, capabilities: { offered: [...offered].sort() }, provenance: { supervisorGeneration: '
    + JSON.stringify(supervisorGeneration)
    + ', issuedAt: '
    + JSON.stringify(issuedAt)
    + ', expiresAt: '
    + JSON.stringify(expiresAt)
    + ' }, integrity: { channel: "local-supervised-ipc" } });\n'
    + '}\n'
    + 'export default { snapbackBasePath, snapbackDevState, createSnapbackDevAppBinding };\n';
}

function assertLoopbackHost(host, { allowNonLoopbackHost, channel, mode }) {
  const effective = host === undefined || host === null ? 'localhost' : host;
  const exposed = effective === true || (typeof effective === 'string' && !LOOPBACK_HOSTS.has(effective));
  if (!exposed) return;
  if (allowNonLoopbackHost) {
    channel.emit({
      event: 'diagnostic',
      code: 'SNAPBACK_DEV_HOST_EXPOSED',
      severity: 'warning',
      mode,
      message: 'non-loopback Vite host explicitly allowed; the Snapback app relay is exposed on the network',
      host: effective === true ? '0.0.0.0' : effective,
    });
    return;
  }
  throw diagnosticError(
    'SNAPBACK_DEV_HOST_EXPOSED',
    'a non-loopback Vite host would expose the Snapback dev relay; set allowNonLoopbackHost: true only if that is intended',
    { host: effective === true ? '0.0.0.0' : effective },
  );
}

export function snapbackDev(options = {}) {
  const base = normalizeRoute(options.route);
  const serverOptions = options.server ?? {};
  const mode = serverOptions.mode ?? 'auto';
  if (!LIFECYCLE_MODES.includes(mode)) {
    throw diagnosticError('SNAPBACK_DEV_SERVER_MODE_INVALID', `unknown Snapback dev mode ${mode}`, {
      mode,
      supported: [...LIFECYCLE_MODES],
    });
  }
  if (mode === 'external' && !serverOptions.url) {
    throw diagnosticError('SNAPBACK_DEV_EXTERNAL_URL_REQUIRED', 'external mode requires server.url');
  }
  const channel = createDiagnosticsChannel(options);

  let command = 'serve';
  let lifecycle = null;
  const verifiedGraphRoots = new Map();
  const supervisorGeneration = `vite-relay:${randomUUID()}`;

  const currentState = () => (lifecycle ? lifecycle.state() : { mode, shape: null, ready: false, serverUrl: null });

  return {
    name: 'snapback-dev',
    enforce: 'pre',

    config(_config, env) {
      command = env.command;
      if (command !== 'serve' || mode === 'off') return undefined;
      return {
        server: {
          fs: {
            deny: [DEV_IDENTITY_DENY_GLOB],
          },
        },
      };
    },

    configResolved(config) {
      const projectRoot = resolve(options.projectRoot ?? config.root);
      for (const generatedRoot of options.generatedRoots ?? []) {
        verifyGeneratedGraph(resolve(projectRoot, generatedRoot));
      }
      if (command !== 'serve' || mode === 'off') return;
      const publicDir = config.publicDir;
      if (publicDir) {
        const carrier = configuredDevIdentityCarriers({
          mode,
          projectRoot,
          serverOptions,
          env: options.env ?? process.env,
        }).find((path) => isWithinDirectory(publicDir, path));
        if (carrier) {
          throw diagnosticError(
            'SNAPBACK_DEV_READY_FILE_INVALID',
            'the dev-identity capability carrier must not be inside Vite publicDir',
            { carrier, publicDir: resolve(publicDir) },
          );
        }
      }
      assertLoopbackHost(config.server?.host, {
        allowNonLoopbackHost: options.allowNonLoopbackHost === true,
        channel,
        mode,
      });
    },

    async configureServer(server) {
      if (mode === 'off') return;
      lifecycle = createSnapbackViteLifecycle({
        mode,
        projectRoot: options.projectRoot ?? server.config.root,
        database: serverOptions.db ?? serverOptions.database,
        readyFile: serverOptions.readyFile,
        url: serverOptions.url,
        runtimeBinary: serverOptions.runtimeBinary,
        readyTimeoutMs: serverOptions.readyTimeoutMs,
        serverStdio: serverOptions.stdio,
        env: options.env,
        setup: options.setup,
        channel,
      });
      try {
        await lifecycle.start();
      } catch (error) {
        channel.emit({
          event: 'diagnostic',
          severity: 'error',
          mode,
          code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_DEV_SERVER_START_FAILED',
          message: error?.message ?? String(error),
          ...(error?.diagnostic?.details ? { details: error.diagnostic.details } : {}),
        });
        throw error;
      }
      const proxy = createSnapbackProxy({
        base,
        mode,
        getState: currentState,
        channel,
        refreshTarget: () => lifecycle.refreshTarget(),
        getDevIdentityCapability: () => lifecycle.readDevIdentityCapability(),
      });
      server.middlewares.use((req, res, next) => proxy.handleRequest(req, res, next));
      server.httpServer?.on('upgrade', (req, socket, head) => {
        proxy.handleUpgrade(req, socket, head);
      });
      server.httpServer?.once('close', () => {
        void lifecycle.close();
      });
    },

    resolveId(id, importer) {
      if (id === VIRTUAL_MODULE_ID) return RESOLVED_VIRTUAL_MODULE_ID;
      const generated = resolveGeneratedImport(id, importer, verifiedGraphRoots);
      if (generated !== null) return generated;
      return undefined;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return undefined;
      // Build output gets the inert shape: same exports, mode 'off', no state.
      const state = command === 'serve' ? currentState() : null;
      return renderVirtualModule({ base, state, supervisorGeneration });
    },
  };
}

export default snapbackDev;
