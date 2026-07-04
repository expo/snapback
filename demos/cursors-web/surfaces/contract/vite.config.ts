// Cursor presence — Contract surface Vite config (ENG-22479), on the
// exactContractWeb paved-road preset (ENG-22463; see the all-aboard config
// for the preset rationale). The surface talks to Snapback DIRECTLY at the
// defined origin: vite under `bun --bun` cannot complete proxied WebSocket
// upgrades, and the live socket is the presence transport.

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(__dirname, '../../../../../exact');
const snapbackTarget = process.env.SNAPBACK_CURSORS_API ?? 'http://127.0.0.1:4425';

// INTERIM Exact source-checkout bridge (ENG-22797).
//
// @ref LLP 0015#exact-dependency-policy — sibling-checkout consumption (ladder
// rung 3) with capability-based, hard-fail resolution: a stale peer checkout at
// ../exact must fail with a CLEAR DIAGNOSTIC when the required Exact capability
// is absent, never a directory-exists assumption and never an opaque hang.
//
// This is the last surface still consuming Exact from a sibling SOURCE checkout.
// The durable fix is the published-package migration in ENG-22564, which is
// BLOCKED: only @ccheever/exact-*@0.1.0 is on the registry, and its Contract
// compiler rejects this surface's rated `publish` view line (LLP 0281 stage 0,
// needs 0.1.1). Until that lands, the `@exact/*` bare specifiers in main.ts and
// the generated bindings cannot resolve, because exact commit 162e2b7e
// (LLP 0264 §4.2) removed the source-alias machinery from the shared
// exactContractWeb preset when all-aboard moved to registry packages
// (ENG-22480) — but cursors-web never migrated. We re-home a trimmed copy of
// that retired `contractWebSourceAliases` here, LOCAL to this one pinned
// surface, so nothing in Exact carries it. Delete this whole block when
// ENG-22564 migrates the surface onto the published packages.
const REQUIRED_EXACT_SOURCES = [
  'packages/exact-devtools/src/contract-web.ts',
  'packages/exact-contract/src/runtime/index.ts',
  'packages/exact-contract/src/channels.ts',
  'packages/exact-renderer/src/web-host.ts',
];

// Trimmed copy of the retired exact `contractWebSourceAliases` (162e2b7e),
// covering the @exact/* the cursors-web contract graph actually imports.
// Subpath entries precede the bare package so the first-match alias resolver
// maps each import to its exact source file.
function exactSourceAliases(root: string) {
  const packages = resolve(root, 'packages');
  return [
    { find: '@exact/contract/compiler', replacement: resolve(packages, 'exact-contract/src/compiler/index.ts') },
    { find: '@exact/contract/runtime', replacement: resolve(packages, 'exact-contract/src/runtime/index.ts') },
    { find: '@exact/contract/channels', replacement: resolve(packages, 'exact-contract/src/channels.ts') },
    { find: '@exact/contract/exports', replacement: resolve(packages, 'exact-contract/src/exports.ts') },
    { find: '@exact/contract/vite-plugin', replacement: resolve(packages, 'exact-contract/src/vite-plugin.ts') },
    { find: '@exact/contract/playwright', replacement: resolve(packages, 'exact-contract/src/playwright.ts') },
    { find: '@exact/contract', replacement: resolve(packages, 'exact-contract/src') },
    { find: '@exact/renderer/web-host', replacement: resolve(packages, 'exact-renderer/src/web-host.ts') },
    { find: '@exact/renderer/dom-mirror', replacement: resolve(packages, 'exact-renderer/src/dom-mirror.ts') },
    { find: '@exact/renderer/host-ops', replacement: resolve(packages, 'exact-renderer/src/host-ops.ts') },
    { find: '@exact/renderer', replacement: resolve(packages, 'exact-renderer/src') },
    { find: '@exact/core', replacement: resolve(packages, 'exact-core/src') },
  ];
}

// Fail loudly and early (before the preset import that also needs the checkout)
// when the sibling checkout can't satisfy the surface's @exact/* imports. A
// vite.config throw exits vite non-zero, so the acceptance suite surfaces this
// message via its "Vite exited" path instead of the opaque 20s "surface never
// booted" timeout (ENG-22797).
function assertExactSourcesResolvable(root: string): void {
  const missing = REQUIRED_EXACT_SOURCES.filter((rel) => !existsSync(resolve(root, rel)));
  if (missing.length === 0) return;
  throw new Error(
    [
      `[cursors-web contract] Cannot resolve this surface's @exact/* imports against the Exact checkout at ${root}.`,
      `Missing required source file(s): ${missing.join(', ')}.`,
      `This surface still consumes Exact from a sibling SOURCE checkout (the retired Phase 0 pattern); it needs`,
      `a checkout whose packages/ provides @exact/renderer/web-host and @exact/contract (runtime, channels).`,
      `Point SNAPBACK_EXACT_ROOT (or ../exact) at a compatible Exact checkout, or land the ENG-22564 migration`,
      `onto the published @ccheever/exact-* packages (blocked on publishing 0.1.1). See snapback ENG-22797.`,
    ].join('\n'),
  );
}

// ENG-22757 (the ENG-22753 pattern): dev-only source-provenance probe. The
// acceptance suites reuse an already-running Vite only after this probe
// proves it serves THIS checkout's tree against THIS run's API origin (the
// Diary 0008 2026-07-01 :4420 gotcha: a Vite from a different working tree
// squatting the default port). The path and response shape pair with
// demos/_kit/provenance.mjs (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
const sourceProvenanceProbe = {
  name: 'snapback-source-provenance',
  configureServer(server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          req: unknown,
          res: { setHeader: (k: string, v: string) => void; end: (body: string) => void },
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'cursors-web',
          surface: 'contract',
          root: realpathSync(__dirname),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default async () => {
  // Interim bridge preflight (ENG-22797): hard-fail with a clear diagnostic
  // before importing the preset when the sibling checkout can't satisfy the
  // surface's Exact imports (LLP 0015 §Exact Dependency Policy).
  assertExactSourcesResolvable(exactRoot);

  const { exactContractWeb } = await import(
    pathToFileURL(resolve(exactRoot, 'packages/exact-devtools/src/contract-web.ts')).href
  );

  return {
    root: __dirname,
    // INTERIM (ENG-22797): revive the retired @exact/* source aliases so this
    // still-pinned surface resolves against the sibling Exact checkout. Remove
    // with the ENG-22564 published-package migration. See the block above.
    resolve: { alias: exactSourceAliases(exactRoot) },
    // ENG-22537: the build-only `typescript` alias stub that used to live
    // here is gone — Exact no longer pulls the compiler into the browser
    // graph from the stage-0 channels import (guarded at the source by
    // exact-contract's client-graph test), so production builds run the
    // same module graph as dev.
    plugins: [
      sourceProvenanceProbe,
      exactContractWeb({
        data: 'snapback',
        exactRoot,
        app: { entry: '/main.ts' },
      }),
    ],
    define: {
      __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
    },
    server: {
      host: '127.0.0.1',
      port: 5184,
      strictPort: false,
      proxy: {
        '/snapback': {
          target: snapbackTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path: string) => path.replace(/^\/snapback/, ''),
        },
      },
    },
  };
};
