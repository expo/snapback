import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPartitimeCostModule } from '../../shared/vite-cost-attribution.mjs';

test('Partitime production cost modules use one stable four-layer partition', () => {
  const cases = new Map([
    ['/checkout/node_modules/@exact/contract/src/runtime/index.ts', 'framework-runtime'],
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
