import { resolve } from 'node:path';
import { defineConfig } from 'vite';

import { contractVitePlugin } from '@exact/contract/vite-plugin';
import {
  exactAssetPlugin,
  exactNativeCssPlugin,
} from '@exact/devtools/vite-plugin';
import { createReactCompilerBabelTransformPlugin } from '@exact/devtools/react-compiler-babel';
import {
  createHermesBundleConfig,
  createHermesDynamicImportFallbackBabelPlugin,
  createHermesEs5BabelPlugin,
} from '@exact/devtools/hermes-bundle-config';
import { exactPlatformVariantBuildPlugin } from './node_modules/@exact/devtools/src/platform-variant-build-plugin.ts';

const outputRoot = process.env.PARTITIME_NATIVE_BUNDLE_OUT;
if (!outputRoot) {
  throw new Error('PARTITIME_NATIVE_BUNDLE_OUT is required');
}

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — this is a
// build-only, agent-free production graph. It deliberately shares Exact's
// release-Hermes configuration primitives instead of the development Vite
// plugin, then emits the single IIFE + source map admitted by the native
// performance collector.
export default defineConfig(createHermesBundleConfig({
  // This measured artifact is Contract-only and agent-off. Mixed or
  // inspectable native graphs intentionally retain the full runtime entry.
  contractProductionRuntime: true,
  plugins: [
    exactPlatformVariantBuildPlugin({ platform: 'native' }),
    exactAssetPlugin({ includeSourcePath: true }),
    exactNativeCssPlugin(),
    contractVitePlugin(),
    createReactCompilerBabelTransformPlugin(),
  ],
  aliases: {
    '@exact/observability/lazy-runtime': resolve(
      import.meta.dirname,
      'node_modules/@exact/observability/src/lazy-runtime.static.ts',
    ),
  },
  define: {
    __PARTITIME_BACKEND__: JSON.stringify(process.env.PARTITIME_BACKEND ?? 'snapback'),
    __PARTITIME_GATEWAY_ORIGIN__: JSON.stringify(
      process.env.PARTITIME_GATEWAY_ORIGIN ?? 'http://127.0.0.1:4460',
    ),
    __PARTITIME_PERFORMANCE_WITNESS_ORIGIN__: JSON.stringify(
      process.env.PARTITIME_PERFORMANCE_WITNESS_ORIGIN ?? 'http://127.0.0.1:18764',
    ),
  },
  input: resolve(import.meta.dirname, 'src/main.native.performance.ts'),
  outFile: 'partitime-native.js',
  name: 'PartitimeExactNativePerformance',
  outDir: resolve(outputRoot),
  // Keep literal generated route imports visible to Rolldown so the
  // single-entry IIFE's inlineDynamicImports policy closes them into the HBC.
  // The fallback transform is only for graphs whose imports are intentionally
  // opaque at build time; applying it here converted the generated Contract
  // route loader into an unconditional runtime rejection.
  rolldownPlugins: [
    createHermesEs5BabelPlugin({
      plugins: [
        createHermesDynamicImportFallbackBabelPlugin({
          preserveLiteralImports: true,
        }),
      ],
    }),
  ],
}));
