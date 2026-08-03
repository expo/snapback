#!/usr/bin/env node

// Independent LLP 0132 semantic oracle for the frozen Diary 0031 Research
// Room vectors. It uses the BigInt dyadic primitive oracle, never a Snapback
// target kernel, and commits admitted binary64 inputs plus exact result bits.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { strictDistanceBits } from './vector-distance-reference.mjs';

const OUTPUT = fileURLToPath(new URL('../tests/conformance/vector-search-v1.corpus.json', import.meta.url));
const DIMENSIONS = 32;
const SOURCE_COUNT = 20;
const QUERY = Array.from({ length: DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));

function embeddingFor(index) {
  const values = Array.from({ length: DIMENSIONS }, (_, dimension) =>
    dimension === index % 20 ? 1 : ((index + dimension) % 17) / 1000,
  );
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

function bits(value) {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, '0');
}

function buildCorpus() {
  const queryBits = QUERY.map(bits);
  const candidates = Array.from({ length: SOURCE_COUNT }, (_, index) => {
    const vectorBits = embeddingFor(index).map(bits);
    return {
      rowId: `source-${String(index).padStart(2, '0')}`,
      vectorBits,
      distances: {
        l2sq: strictDistanceBits('l2sq', queryBits, vectorBits),
        dot: strictDistanceBits('dot', queryBits, vectorBits),
      },
    };
  });
  const ranked = (metric, descending) => candidates
    .map((candidate) => ({ rowId: candidate.rowId, bits: candidate.distances[metric] }))
    .sort((left, right) => {
      const order = BigInt(`0x${left.bits}`) < BigInt(`0x${right.bits}`) ? -1
        : BigInt(`0x${left.bits}`) > BigInt(`0x${right.bits}`) ? 1 : 0;
      return (descending ? -order : order) || left.rowId.localeCompare(right.rowId);
    })
    .map(({ rowId }) => rowId);
  return {
    schemaVersion: 1,
    profile: 'snapback-vector-distance-v1',
    source: 'Diary 0031 frozen Research Room embeddingFor(index), 20 sources',
    dimensions: DIMENSIONS,
    queryBits,
    candidates,
    expectedRanks: {
      l2sq: ranked('l2sq', false),
      dot: ranked('dot', true),
    },
  };
}

const rendered = `${JSON.stringify(buildCorpus(), null, 2)}\n`;
if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, rendered);
} else if (process.argv.includes('--check')) {
  if (readFileSync(OUTPUT, 'utf8') !== rendered) {
    throw new Error('vector-search-v1 corpus differs from the independent semantic oracle');
  }
} else {
  process.stdout.write(rendered);
}
