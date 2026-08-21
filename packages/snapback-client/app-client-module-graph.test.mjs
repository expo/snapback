import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rootSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
const appClientSource = readFileSync(new URL('./app-client.mjs', import.meta.url), 'utf8');
const rootTypes = readFileSync(new URL('./index.d.mts', import.meta.url), 'utf8');
const appClientTypes = readFileSync(new URL('./app-client.d.mts', import.meta.url), 'utf8');
const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

assert.equal(
  /export\s*\{[^}]*DEFAULT_AUTH_STORAGE_PARTITION[^}]*\}\s*from '\.\/app-client\.mjs'/u.test(rootSource),
  false,
  'the root barrel must not resolve DEFAULT_AUTH_STORAGE_PARTITION through app-client.mjs',
);
const defaultsSource = readFileSync(new URL('./app-client-defaults.mjs', import.meta.url), 'utf8');
assert.match(
  rootSource,
  /export \{ DEFAULT_AUTH_STORAGE_PARTITION \} from '\.\/app-client-defaults\.mjs';/u,
);
assert.match(
  appClientSource,
  /import \{ DEFAULT_AUTH_STORAGE_PARTITION \} from '\.\/app-client-defaults\.mjs';/u,
);
assert.match(
  rootTypes,
  /export \{ DEFAULT_AUTH_STORAGE_PARTITION \} from '\.\/app-client-defaults\.mjs';/u,
);
assert.match(
  appClientTypes,
  /export \{ DEFAULT_AUTH_STORAGE_PARTITION \} from '\.\/app-client-defaults\.mjs';/u,
);
assert.equal(
  /\b(?:import|export)\b[\s\S]*\bfrom\s+['"]/u.test(defaultsSource),
  false,
  'the initialization-time defaults leaf must not acquire an import back-edge',
);
for (const path of ['app-client-defaults.mjs', 'app-client-defaults.d.mts']) {
  assert.ok(packageManifest.files.includes(path), `packed client must include ${path}`);
}
assert.deepEqual(packageManifest.exports['.'], {
  types: './index.d.mts',
  import: './index.mjs',
});

const [rootModule, appClientModule] = await Promise.all([
  import('./index.mjs'),
  import('./app-client.mjs'),
]);
assert.equal(rootModule.DEFAULT_AUTH_STORAGE_PARTITION, 'default');
assert.equal(appClientModule.DEFAULT_AUTH_STORAGE_PARTITION, 'default');
assert.equal(
  rootModule.DEFAULT_AUTH_STORAGE_PARTITION,
  appClientModule.DEFAULT_AUTH_STORAGE_PARTITION,
  'the root and direct app-client entries expose the same leaf binding',
);

console.log('app client module graph: storage partition resolves from a packed cycle-free leaf');
