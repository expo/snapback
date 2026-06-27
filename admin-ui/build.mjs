// Programmatic static build of the Snapback admin Contract console.
//
// We call Vite's build() with `configFile: false` and an inline config (NOT
// `vite build --config`). This is deliberate: exactVitePlugin's static exporter
// spins up a nested prerender server, and with a config FILE it re-loads our
// config — dragging contractVitePlugin into the nested server, which breaks
// SSR-loading the route registry ("Could not locate appRouteModules"). With
// `configFile: false` the exporter takes its well-configured branch and the
// registry loads. (Finding from the LLP 0268 build experiment.)
//
// Run via bun (it imports the Exact .ts sources directly). See build.sh.
//
// @ref LLP 0017#static-bundling-and-the-native-shell — emits the LLP 0268 static
// platform manifest + mac native envelope so the macOS Exact shell can load the
// static snapshot.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exactRoot = process.env.SNAPBACK_EXACT_ROOT ?? resolve(here, '../../exact');

const { build } = await import(resolve(exactRoot, 'node_modules/vite/dist/node/index.js'));
const { exactVitePlugin } = await import(
  resolve(exactRoot, 'packages/exact-devtools/src/vite-plugin.ts')
);
const { contractVitePlugin } = await import(
  resolve(exactRoot, 'packages/exact-contract/src/vite-plugin.ts')
);
const { workspaceAliases } = await import(resolve(exactRoot, 'js/vite.shared.ts'));

await build({
  appType: 'custom',
  configFile: false,
  logLevel: 'info',
  root: here,
  base: '/_snapback/admin/',
  plugins: [
    exactVitePlugin({
      entry: '/src/main.ts',
      // The served-app basePath prefixes the emitted web entry + asset URLs so
      // they resolve where the Rust server mounts the console. Native artifact
      // URLs stay document-relative, so the macOS shell loads regardless.
      apps: [{ basePath: '/_snapback/admin/', entry: '/src/main.ts' }],
      staticPlatformTargets: ['mac'],
    }),
    contractVitePlugin(),
  ],
  resolve: {
    alias: workspaceAliases,
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
  },
});

// exactVitePlugin emits the web entry as root-absolute (`/assets/…`) and the
// native discovery as document-relative (`./__exact/…`); the web side has no
// basePath support yet. Rewrite both to absolute under the `/_snapback/admin/`
// mount so the dist is self-consistent there for the browser AND the macOS shell
// (which then reads an absolute envelopeUrl, working regardless of trailing
// slash). The native envelope's own `./startup.js` stays relative to its URL.
const indexPath = resolve(here, 'dist/index.html');
const rewritten = readFileSync(indexPath, 'utf8')
  .replaceAll('"/assets/', '"/_snapback/admin/assets/')
  .replaceAll('"./__exact/', '"/_snapback/admin/__exact/');
writeFileSync(indexPath, rewritten);

console.log('admin-ui: static build OK ->', resolve(here, 'dist'));

