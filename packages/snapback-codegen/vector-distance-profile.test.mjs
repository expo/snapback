// Cross-language consumer and independent exact-oracle gate for LLP 0132's
// deliberately unpublished numeric profile.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decimalToBits,
  forbiddenAlternativeBits,
  profileDigest,
  roundDecimalToSignificantDigits,
  strictDistanceBits,
} from '../../scripts/vector-distance-reference.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const artifact = JSON.parse(readFileSync(
  join(repoRoot, 'schemas', 'vector.distance-profile-v1.json'),
  'utf8',
));

function fromBits(text) {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${text}`), false);
  return view.getFloat64(0, false);
}

function bits(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, '0');
}

// This is the JavaScript semantic kernel under test. The independent oracle
// above uses only BigInt exact arithmetic and never calls this function.
function javascriptStrictDistance(metric, queryBits, candidateBits) {
  const query = queryBits.map(fromBits);
  const candidate = candidateBits.map(fromBits);
  let accumulator = 0;
  for (let index = 0; index < query.length; index += 1) {
    let term;
    if (metric === 'l2sq') {
      const difference = query[index] - candidate[index];
      term = difference * difference;
    } else if (metric === 'dot') {
      term = query[index] * candidate[index];
    } else {
      throw new TypeError(`unknown vector metric ${metric}`);
    }
    accumulator += term;
  }
  return bits(Object.is(accumulator, -0) ? 0 : accumulator);
}

assert.equal(artifact.artifactKind, 'vectorDistanceProfileV1');
assert.equal(artifact.formatVersion, 1);
assert.equal(artifact.profile.profileId, 'snapback-vector-distance-v1');
assert.equal(artifact.profile.orderingProfileId, 'nearest-first-row-id.v1');
assert.equal(profileDigest(artifact.profile), artifact.profileDigest);

for (const witness of artifact.profile.conversionWitnesses) {
  assert.equal(decimalToBits(witness.decimal), witness.expectedBits, `${witness.name}: exact oracle`);
  assert.equal(bits(Number(witness.decimal)), witness.expectedBits, `${witness.name}: JavaScript parser`);
  if (witness.admittedBits) {
    const value = Number(witness.decimal);
    const admitted = value === 0 ? 0 : value;
    assert.equal(bits(admitted), witness.admittedBits, `${witness.name}: admission`);
  }
  if (witness.finiteHDigits !== undefined) {
    const rounded = roundDecimalToSignificantDigits(witness.decimal, witness.finiteHDigits);
    assert.equal(rounded, witness.roundedToHDecimal, `${witness.name}: round-to-H decimal`);
    assert.equal(decimalToBits(rounded), witness.roundedToHBits, `${witness.name}: round-to-H bits`);
    assert.notEqual(witness.roundedToHBits, witness.expectedBits, `${witness.name}: double-rounding distinction`);
  }
}

const requiredDivergences = new Set([
  'fma-contraction',
  'reassociation-reduction-reorder',
  'extended-precision-x87',
  'ftz-daz-subnormal-flushing',
  'one-ulp-decimal-conversion',
]);
const coverage = new Map([...requiredDivergences].map((purpose) => [purpose, new Set()]));

for (const witness of artifact.profile.distanceWitnesses) {
  if (witness.wireInputs) {
    assert.deepEqual(
      witness.wireInputs.queryDecimals.map(decimalToBits),
      witness.queryBits,
      `${witness.name}: wire query conversion`,
    );
    assert.deepEqual(
      witness.wireInputs.candidateDecimals.map(decimalToBits),
      witness.candidateBits,
      `${witness.name}: wire candidate conversion`,
    );
  }
  assert.equal(
    strictDistanceBits(witness.metric, witness.queryBits, witness.candidateBits),
    witness.expectedBits,
    `${witness.name}: exact strict oracle`,
  );
  assert.equal(
    javascriptStrictDistance(witness.metric, witness.queryBits, witness.candidateBits),
    witness.expectedBits,
    `${witness.name}: JavaScript kernel`,
  );
  assert.equal(
    forbiddenAlternativeBits(witness),
    witness.forbiddenAlternativeBits,
    `${witness.name}: forbidden alternative`,
  );
  if (witness.purpose === 'extended-precision-x87') {
    assert.equal(
      forbiddenAlternativeBits({ ...witness, forbiddenAlternative: 'reverse-reduction-order' }),
      witness.expectedBits,
      `${witness.name}: extended intermediate is distinct from reverse-order reduction`,
    );
  }
  if (requiredDivergences.has(witness.purpose)) {
    assert.notEqual(
      witness.forbiddenAlternativeBits,
      witness.expectedBits,
      `${witness.name}: must distinguish ${witness.purpose}`,
    );
    coverage.get(witness.purpose).add(witness.metric);
  }
}

for (const [purpose, metrics] of coverage) {
  assert.deepEqual(metrics, new Set(['dot', 'l2sq']), `${purpose}: per-metric coverage`);
}

for (const witness of artifact.profile.orderingWitnesses) {
  const ordered = [witness.leftRowIdHex, witness.rightRowIdHex].sort();
  if (witness.direction === 'id-desc') ordered.reverse();
  assert.equal(ordered[0], witness.expectedFirstRowIdHex, witness.name);
}

console.log(`vector-distance-profile: ${artifact.profileDigest}`);
