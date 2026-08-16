import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPartitimeCostModule,
  portablePartitimeArtifactProvenance,
  portablePartitimeCostModuleId,
} from '../../shared/vite-cost-attribution.mjs';

test('Partitime production cost modules use one stable four-layer partition', () => {
  const cases = new Map([
    ['/checkout/node_modules/@exact/contract/src/runtime/index.ts', 'framework-runtime'],
    ['/checkout/demos/partiful-matrix/surfaces/contract/node_modules/@exact/contract/src/runtime/instance.ts', 'framework-runtime'],
    ['C:\\checkout\\demos\\partiful-matrix\\surfaces\\react\\node_modules\\react\\index.js', 'framework-runtime'],
    ['/checkout/demos/partiful-matrix/surfaces/react/node_modules/@supabase/supabase-js/dist/index.js', 'provider-runtime'],
    ['/checkout/demos/partiful-matrix/surfaces/contract/node_modules/convex/dist/esm/browser/index.js', 'provider-runtime'],
    ['/checkout/packages/snapback-client/index.mjs', 'provider-runtime'],
    ['/checkout/demos/partiful-matrix/surfaces/react/src/provider.ts', 'provider-runtime'],
    ['/checkout/demos/partiful-matrix/surfaces/contract/data/provider.generated.ts', 'generated-app-data'],
    ['/checkout/demos/partiful-matrix/snapback/generated/artifacts.json', 'generated-app-data'],
    ['/checkout/demos/partiful-matrix/surfaces/react/src/App.tsx', 'application-code'],
    ['C:\\checkout\\demos\\partiful-matrix\\surfaces\\vanilla\\src\\main.js', 'application-code'],
  ]);
  for (const [path, expected] of cases) {
    assert.equal(classifyPartitimeCostModule(path), expected, path);
  }
});

test('Partitime production cost module ids are portable', () => {
  const repoRoot = '/private/tmp/snapback-attribution-repro';
  assert.equal(
    portablePartitimeCostModuleId(
      `${repoRoot}/demos/partiful-matrix/surfaces/react/src/App.tsx`,
      { repoRoot },
    ),
    'demos/partiful-matrix/surfaces/react/src/App.tsx',
  );
  assert.equal(
    portablePartitimeCostModuleId('/Users/builder/exact/src/runtime.ts', { repoRoot }),
    '[external]/runtime.ts',
  );
  assert.equal(
    portablePartitimeCostModuleId('C:\\builder\\exact\\src\\runtime.ts', { repoRoot }),
    '[external]/runtime.ts',
  );
  assert.equal(
    portablePartitimeCostModuleId('\0virtual:partitime', { repoRoot }),
    '\0virtual:partitime',
  );
  assert.equal(
    portablePartitimeCostModuleId(
      `\0${repoRoot}/demos/partiful-matrix/surfaces/react/node_modules/react/index.js?commonjs-module`,
      { repoRoot },
    ),
    '\0demos/partiful-matrix/surfaces/react/node_modules/react/index.js?commonjs-module',
  );
  assert.deepEqual(
    portablePartitimeArtifactProvenance({
      sourcePath: `${repoRoot}/demos/partiful-matrix/surfaces/contract/feed.contract`,
      route: '/events/event_sunset/',
    }, { repoRoot }),
    {
      sourcePath: 'demos/partiful-matrix/surfaces/contract/feed.contract',
      route: '/events/event_sunset/',
    },
  );
});
