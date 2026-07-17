// Keep the admin theme helpers' Contract dependency descriptors honest.
// Exact's source analyzer is the authority for hidden module/host reads; this
// test prevents a helper change from silently outgrowing its declared model.
//
// @ref LLP 0017#static-bundling-and-the-native-shell — the same Contract app
// must keep a valid web build and a native-capable fallback without DOM state.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (typeof Bun === 'undefined') {
  const result = spawnSync(process.env.BUN ?? 'bun', [fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const adminRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themePath = resolve(adminRoot, 'theme.ts');
const themeSource = readFileSync(themePath, 'utf8');
const { analyzeContractImportSource } = await import('@exact/contract/compiler');
const { default: themeModule } = await import('../theme.contract-meta.ts');
const { colors, initialTab, systemTheme, watchSystemTheme } = await import('../theme.ts');

const expectedHiddenDependencies = {
  colors: [
    ['DARK', 'module-state'],
    ['LIGHT', 'module-state'],
  ],
  initialTab: [
    ['decodeURIComponent', 'host-state'],
    ['location', 'host-state'],
  ],
  systemTheme: [
    ['globalThis', 'host-state'],
    ['matchMedia', 'host-state'],
  ],
};

for (const [exportName, expected] of Object.entries(expectedHiddenDependencies)) {
  const analysis = analyzeContractImportSource(themeSource, exportName, {
    fileName: themePath,
  });
  assert.equal(analysis.found, true, `${exportName} must remain analyzable by Exact`);
  const actual = analysis.hiddenDependencies
    .map(({ name, kind }) => [name, kind])
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(actual, expected, `${exportName} hidden dependencies changed`);
  assert.deepEqual(
    [...themeModule.exports[exportName].depends].sort(),
    expected.map(([name]) => name).sort(),
    `${exportName} Contract descriptor must declare every hidden dependency`,
  );
}

assert.equal(themeModule.exports.watchSystemTheme.kind, 'capability');
assert.deepEqual(themeModule.exports.watchSystemTheme.effects, [
  'theme.scheme.read',
  'theme.store.subscribe',
]);

assert.equal(colors('light').scheme, 'light');
assert.equal(colors('dark').scheme, 'dark');
assert.notEqual(colors('light').canvas, colors('dark').canvas);

const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
const previousMatchMedia = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
try {
  delete globalThis.location;
  assert.equal(initialTab(), 'Overview', 'native-capable hosts need no location');
  globalThis.location = { hash: '#Diagnostics' };
  assert.equal(initialTab(), 'Diagnostics', 'web location hashes select an admin tab');

  let changeListener;
  let removedListener;
  globalThis.matchMedia = () => ({
    matches: true,
    addEventListener(event, listener) {
      assert.equal(event, 'change');
      changeListener = listener;
    },
    removeEventListener(event, listener) {
      assert.equal(event, 'change');
      removedListener = listener;
    },
  });
  assert.equal(systemTheme(), 'dark', 'web host preference initializes dark mode');
  const changes = [];
  const stopWatching = watchSystemTheme((mode) => changes.push(mode));
  globalThis.matchMedia = () => ({ matches: false });
  changeListener();
  assert.deepEqual(changes, ['light'], 'host preference changes reach Contract state');
  stopWatching();
  assert.equal(removedListener, changeListener, 'theme subscription cleanup detaches the listener');
} finally {
  delete globalThis.location;
  if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation);
  delete globalThis.matchMedia;
  if (previousMatchMedia) Object.defineProperty(globalThis, 'matchMedia', previousMatchMedia);
}

console.log('admin theme Contract dependencies: explicit and behaviorally valid');
