// The client root export must stay bundler-safe: the packaged release proof
// (scripts/snapback-package-cold-install.mjs) Metro-bundles it inside an Expo
// app (`expo export --platform ios`) and esbuild-bundles it for the browser,
// then refuses any Node builtin specifier in the emitted bundle. Metro
// statically resolves even lazy literal `import('node:...')` specifiers, so a
// Node-only dependency reachable from index.mjs fails the staged proof on
// both platforms. This is the fast repo-side witness of the same closure:
// an esbuild browser build of the root export must succeed and emit no
// builtin specifier. Node-only capability belongs behind
// `process.getBuiltinModule` lookups (see rqs-store-file.mjs) or Node-only
// subpath exports that the root never reaches.

import assert from 'node:assert/strict';
import { build } from 'esbuild';

for (const entry of [
  'index.mjs',
  'ir-evaluator.mjs',
  'local-read-admission.mjs',
  'materialization-store.mjs',
  'optimistic-rebase.mjs',
]) {
  const result = await build({
    entryPoints: [new URL(`./${entry}`, import.meta.url).pathname],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    logLevel: 'silent',
  });
  const bundled = result.outputFiles[0].text;
  assert.ok(bundled.length > 0, `${entry}: the browser bundle must not be empty`);
  const builtinReference = bundled.match(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]node:[^'"]+/u,
  );
  assert.equal(
    builtinReference,
    null,
    `${entry}: the browser closure references a Node builtin: ${builtinReference?.[0]?.trim()}`,
  );
  const expoFileSystemReference = bundled.match(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]expo-file-system['"]/u,
  );
  assert.equal(
    expoFileSystemReference,
    null,
    `${entry}: the browser closure imports expo-file-system: ${expoFileSystemReference?.[0]?.trim()}`,
  );
}
assert.doesNotMatch(
  'process.getBuiltinModule("node:crypto")',
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]node:[^'"]+/u,
  'capability-gated process.getBuiltinModule lookups are not imports',
);

console.log('browser-closure.test.mjs passed');
