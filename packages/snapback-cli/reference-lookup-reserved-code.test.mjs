import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  formatGuideReferenceLookup,
  lookupGuideReference,
} from './reference-lookup.mjs';

const root = resolve(import.meta.dirname, '../..');
const reservedDiagnostic = lookupGuideReference(
  ['SNAPBACK_IBEX_CLI_UNAVAILABLE'],
  { projectRoot: root, includeDiagnosticSites: true },
);

assert.equal(reservedDiagnostic.match, 'diagnostic');
assert.deepEqual(
  reservedDiagnostic.diagnostic.sites.map(({ file, kind }) => ({ file, kind })),
  [{ file: 'crates/snapback-runtime/src/runtime.rs', kind: 'reserved' }],
);
const output = formatGuideReferenceLookup(reservedDiagnostic);
assert.match(output, /\nReserved sites:\n- crates\/snapback-runtime\/src\/runtime\.rs:/u);
assert.doesNotMatch(output, /\nEmitting sites:/u);

console.log('reference-lookup-reserved-code.test.mjs: reserved sites retain their non-emitting label');
