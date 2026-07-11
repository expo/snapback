// All Aboard — Contract surface Vite config (ENG-22463: paved-road preset;
// ENG-22480: registry packages).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) composes the Contract
// compiler plugin and the Exact app plugin — `vite` dev with the agent
// surface AND a production `vite build` (ENG-22441) — with
// external-surface-safe defaults: shell 'auto' preserves this surface's own
// ./index.html (ENG-22445), the agent-readiness audit is off, and static
// native artifacts/desktop manifests are enabled only on this surface's build
// path. It fails builds whose client chunks leak Node/native-only modules.
//
// ENG-22480: Exact is consumed from the npm registry — `@exact/*` imports
// resolve through npm alias dependencies to the published
// `@ccheever/exact-*` packages (see package.json), and `bun.lock` pins the
// exact bits (it replaced `exact.pin.json`). No sibling checkout, no
// `SNAPBACK_EXACT_ROOT`, no source aliases: the preset itself is imported
// from this surface's own node_modules. The packages ship TS source, so the
// vite binary runs under bun (`bun --bun node_modules/.bin/vite`, see the
// package.json scripts), which loads this TS config and the TS preset from
// node_modules.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Page-visible API origin (injected into the browser bundle). `same-origin`
// makes the kit use relative `/snapback/*` paths so a Tailscale/LAN Vite host
// stays same-origin and avoids Snapback's loopback-only CORS.
const snapbackApiOrigin = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';
// Upstream the Vite `/snapback` proxy actually dials. When the page origin is
// `same-origin`, the proxy still needs a real localhost API target.
const snapbackProxyTarget =
  process.env.SNAPBACK_ALL_ABOARD_API_PROXY ??
  (snapbackApiOrigin === 'same-origin' ? 'http://127.0.0.1:4420' : snapbackApiOrigin);

// ENG-22753: dev-only source-provenance probe. The acceptance suites reuse an
// already-running Vite only after this probe proves it serves THIS checkout's
// tree against THIS run's API origin (the Diary 0008 2026-07-01 :4420 gotcha:
// a Vite from a different working tree squatting the default port). The path
// and response shape pair with demos/_kit/provenance.mjs
// (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
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
          app: 'all-aboard',
          surface: 'contract',
          root: realpathSync(__dirname),
          apiOrigin: snapbackApiOrigin,
        }),
      );
    });
  },
};
function sourceAliases(exactRoot: string | undefined): Record<string, string> | undefined {
  if (!exactRoot) return undefined;
  const source = (...parts: string[]) => resolve(exactRoot, ...parts);
  return {
    '@exact/contract/runtime': source('packages/exact-contract/src/runtime/index.ts'),
    '@exact/contract/exports': source('packages/exact-contract/src/exports.ts'),
    '@exact/contract': source('packages/exact-contract/src/index.ts'),
    '@exact/core/host-call-bridge': source('packages/exact-core/src/host-call-bridge.ts'),
    '@exact/renderer/host-ops': source('packages/exact-renderer/src/host-ops.ts'),
    '@exact/renderer/dom-mirror': source('packages/exact-renderer/src/dom-mirror.ts'),
    '@exact/renderer/runtime': source('packages/exact-renderer/src/runtime.ts'),
    '@exact/renderer/web-host': source('packages/exact-renderer/src/web-host.ts'),
    '@exact/renderer': source('packages/exact-renderer/src/index.ts'),
    '@exact/router/browser': source('packages/exact-router/src/browser.ts'),
    '@exact/router/contract': source('packages/exact-router/src/contract.ts'),
    '@exact/router/router': source('packages/exact-router/src/router.ts'),
    '@exact/router/url-channel': source('packages/exact-router/src/url-channel.ts'),
    '@exact/router': source('packages/exact-router/src/index.ts'),
  };
}

export default async ({ command }: { command: 'serve' | 'build' }) => {
  // G8 cross-repo acceptance pins an Exact checkout and sets this explicit
  // source root. Normal product builds remain registry-only; the override is
  // solely the native compatibility gate that must exercise the candidate
  // Exact commit before its packages exist on npm.
  const exactSourceRoot = process.env.EXACT_ALL_ABOARD_SOURCE_ROOT
    ? realpathSync(process.env.EXACT_ALL_ABOARD_SOURCE_ROOT)
    : undefined;
  const contractWebModule = exactSourceRoot
    ? await import(pathToFileURL(resolve(exactSourceRoot, 'packages/exact-devtools/src/contract-web.ts')).href)
    : await import('@exact/devtools/contract-web');
  const { exactContractWeb } = contractWebModule;
  return ({
  root: __dirname,
  plugins: [
    sourceProvenanceProbe,
    exactContractWeb({
      data: 'snapback',
      app: {
        entry: command === 'build' ? '/native.ts' : '/main.ts',
        staticPlatformTargets: command === 'build' ? ['mac', 'ios'] : false,
        emitDesktopManifests: command === 'build',
      },
    }),
  ],
  define: {
    // The surface talks to Snapback DIRECTLY at this origin (HTTP under the
    // server's loopback CORS; the live WebSocket needs no CORS). Direct is
    // the same pattern cursors-web uses, and it sidesteps a real bug: vite
    // under `bun --bun` never completes proxied WebSocket upgrades (the
    // ws:true proxy below logs the forward, then the tunnel hangs), which
    // would leave the stream transport permanently connecting.
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackApiOrigin),
  },
  resolve: {
    alias: sourceAliases(exactSourceRoot),
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: false,
    // Tailscale MagicDNS / LAN hostnames must be allowed when the UI is opened
    // off-loopback (Vite 8 blocks unknown Host headers with 403 by default).
    allowedHosts: true,
    proxy: {
      '/snapback': {
        target: snapbackProxyTarget,
        changeOrigin: true,
        // The live stream (LLP 0034 D1) is a WebSocket at
        // /snapback/live/{connection}/stream; without ws:true the proxy
        // never upgrades and the browser surface can only poll.
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
  });
};
