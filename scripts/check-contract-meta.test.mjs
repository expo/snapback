import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  checkContractMetaPair,
  refreshContractMetaPair,
} from './check-contract-meta.mjs';

const directory = mkdtempSync(join(tmpdir(), 'snapback-contract-meta-'));
const source = join(directory, 'data.ts');
const sidecar = join(directory, 'data.contract-meta.ts');
try {
  writeFileSync(source, `
export function boardTrains(stationId: string, direction: string) { return []; }
export const MEDIA_OPTIONS = [{ id: 'image-1' }];
`);
  writeFileSync(sidecar, `
import { defineContractModule, pure } from '@exact/contract/exports';
export default defineContractModule('./data.ts', {
  boardTrains: pure({ params: ['stationId'], result: 'HeroBoard', depends: 'args' }),
  MEDIA_OPTIONS: pure({ params: [], result: 'MediaOption[]', depends: 'args' }),
});
`);
  const diagnostics = checkContractMetaPair(source, sidecar);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'SNAPBACK_CONTRACT_META_PARAMS_DRIFT');
  assert.deepEqual(diagnostics[0].actual, ['stationId', 'direction']);
  assert.deepEqual(diagnostics[0].mirrored, ['stationId']);
  assert.match(diagnostics[0].message, /regenerate or update/);
  const refreshed = refreshContractMetaPair(source, sidecar);
  assert.equal(refreshed.changed, true);
  writeFileSync(sidecar, refreshed.source);
  assert.match(readFileSync(sidecar, 'utf8'), /params: \["stationId","direction"\]/u);
  assert.deepEqual(checkContractMetaPair(source, sidecar), []);

  writeFileSync(sidecar, readFileSync(sidecar, 'utf8').replace(
    "MEDIA_OPTIONS: pure({ params: []",
    "MEDIA_OPTIONS: pure({ params: ['invented']",
  ));
  const valueDiagnostics = checkContractMetaPair(source, sidecar);
  assert.equal(valueDiagnostics.length, 1);
  assert.equal(valueDiagnostics[0].code, 'SNAPBACK_CONTRACT_META_PARAMS_DRIFT');
  assert.deepEqual(valueDiagnostics[0].actual, []);
  assert.deepEqual(valueDiagnostics[0].mirrored, ['invented']);

  writeFileSync(source, `
declare function makeThing(): () => void;
export const wrappedHelper = (((stationId: string) => stationId));
export const CONST_OPTIONS = ([{ id: 'image-1' }] as const);
export const factoryThing = makeThing();
`);
  writeFileSync(sidecar, `
import { defineContractModule, pure } from '@exact/contract/exports';
export default defineContractModule('./data.ts', {
  wrappedHelper: pure({ params: [], result: 'string', depends: 'args' }),
  CONST_OPTIONS: pure({ params: [], result: 'MediaOption[]', depends: 'args' }),
  factoryThing: pure({ params: [], result: 'unknown', depends: 'args' }),
});
`);
  const classificationDiagnostics = checkContractMetaPair(source, sidecar);
  assert.equal(classificationDiagnostics.length, 2);
  assert.equal(classificationDiagnostics[0].exportName, 'wrappedHelper');
  assert.equal(classificationDiagnostics[0].code, 'SNAPBACK_CONTRACT_META_PARAMS_DRIFT');
  assert.deepEqual(classificationDiagnostics[0].actual, ['stationId']);
  assert.deepEqual(classificationDiagnostics[0].mirrored, []);
  assert.equal(classificationDiagnostics[1].exportName, 'factoryThing');
  assert.equal(classificationDiagnostics[1].code, 'SNAPBACK_CONTRACT_META_EXPORT_MISSING');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log('check-contract-meta.test.mjs: all assertions passed');
