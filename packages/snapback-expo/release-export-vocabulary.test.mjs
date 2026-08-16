import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const entryPoint = fileURLToPath(new URL('./index.mjs', import.meta.url));
const forbiddenVocabulary = [
  'EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN',
  '/_snapback/expo/v1/bootstrap',
  'localhost',
  '10.0.2.2',
  '/_snapback/expo/v1/dev-identity-checkout',
  'x-snapback-dev-identity-checkout',
  'SNAPBACK_EXPO_DEV_IDENTITY_CHECKOUT_NONCE',
  '__SNAPBACK_EXPO_SUPERVISOR_ORIGIN__',
  '10.0.2',
  '[::1]',
  '127(?:',
];
const g4Vocabulary = forbiddenVocabulary.slice(0, 7);

async function bundle({ nodeEnv, minify }) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    packages: 'external',
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    minify,
    // Model Metro constant folding independently of full output minification.
    minifySyntax: true,
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles.map((file) => file.text).join('\n');
}

const productionMinified = await bundle({ nodeEnv: 'production', minify: true });
const productionUnminified = await bundle({ nodeEnv: 'production', minify: false });
const development = await bundle({ nodeEnv: 'development', minify: false });

for (const [profile, output] of [
  ['production minified', productionMinified],
  ['production unminified', productionUnminified],
]) {
  for (const forbidden of forbiddenVocabulary) {
    assert(!output.includes(forbidden), `${profile} export retained ${forbidden}`);
  }
}
for (const expected of g4Vocabulary) {
  assert(development.includes(expected), `development export lost ${expected}`);
}

console.log('release-export-vocabulary.test.mjs: production exports prune supervised endpoint vocabulary and development retains it');
