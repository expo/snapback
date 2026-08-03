// @ref LLP 0132#acceptance — every claimed target runs the same Rust-owned
// conversion/arithmetic corpus and compares binary64 result bits.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const corpus = JSON.parse(readFileSync(
  join(repositoryRoot, 'schemas', 'vector.distance-fixtures-v1.json'),
  'utf8',
));

function bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, '0');
}

function distance(metric, query, candidate) {
  let accumulator = 0;
  for (let index = 0; index < query.length; index += 1) {
    let term;
    if (metric === 'l2sq') {
      const delta = query[index] - candidate[index];
      term = delta * delta;
    } else if (metric === 'dot') {
      term = query[index] * candidate[index];
    } else {
      throw new Error(`unknown vector metric ${metric}`);
    }
    accumulator += term;
  }
  return Object.is(accumulator, -0) ? 0 : accumulator;
}

assert.equal(corpus.artifactKind, 'vectorDistanceFixturesV1');
assert.equal(corpus.distanceProfile, 'snapback-vector-distance-v1');
assert.deepEqual(corpus.targets, ['rust', 'javascript']);
assert.deepEqual(
  new Set(corpus.distances.map(({ divergenceClass }) => divergenceClass)),
  new Set([
    'baseline',
    'fma-contraction',
    'reassociation-reduction-order',
    'extended-precision-x87',
    'ftz-daz-subnormal',
    'component-bound',
  ]),
);

for (const witness of corpus.conversion) {
  const converted = Number(witness.decimal);
  assert.equal(bits(converted), witness.expectedBits, witness.name);
  if (witness.admittedBits) {
    const admitted = converted === 0 ? 0 : converted;
    assert.equal(bits(admitted), witness.admittedBits, `${witness.name}: admission`);
  }
}

for (const witness of corpus.distances) {
  assert.equal(
    bits(distance(witness.metric, witness.query, witness.candidate)),
    witness.expectedBits,
    witness.name,
  );
}

assert.equal(
  corpus.conversionEvidence.find(({ target }) => target === 'javascript')
    ?.correctlyRoundedAtAnyInputLength,
  true,
);
assert.equal(
  corpus.kernelEvidence.find(({ target }) => target === 'javascript')?.fastMath,
  false,
);

console.log('vector-distance-fixtures.test.mjs: Rust and JavaScript bits agree');
