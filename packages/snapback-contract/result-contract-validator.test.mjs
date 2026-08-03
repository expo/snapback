import assert from 'node:assert/strict';

import { compileResultContractValidator } from './result-contract-validator.mjs';

const row = Object.freeze({
  kind: 'object',
  fields: Object.freeze([
    Object.freeze({ name: 'kind', required: true, value: { kind: 'literal', value: 'item' } }),
    Object.freeze({ name: 'title', required: true, value: { kind: 'string', maxBytes: 8 } }),
    Object.freeze({
      name: 'count',
      required: false,
      value: { kind: 'integer', min: 0, max: 10 },
    }),
  ]),
  allowExtra: false,
});
const validator = compileResultContractValidator({
  kind: 'records',
  record: row,
});
assert.deepEqual(
  validator.validate([{ kind: 'item', title: 'hello', count: 2 }]).value,
  [{ kind: 'item', title: 'hello', count: 2 }],
);
assert.equal(validator.validate([{ kind: 'item', title: 'too-long!', count: 2 }]).ok, false);
assert.equal(validator.validate([{ kind: 'item', title: 'hello', extra: true }]).ok, false);

const assetRef = compileResultContractValidator({
  kind: 'value',
  value: { kind: 'assetRef' },
});
assert.equal(assetRef.validate('asset_0198').ok, true);
assert.equal(assetRef.validate({ assetId: 'asset_0198' }).ok, false);
assert.equal(assetRef.validate('').ok, false);

const exactlyOneRow = compileResultContractValidator({
  kind: 'records',
  record: row,
  rows: { minItems: 1, maxItems: 1 },
});
assert.equal(exactlyOneRow.validate([]).ok, false);
assert.equal(exactlyOneRow.validate([{ kind: 'item', title: 'one' }]).ok, true);
assert.equal(exactlyOneRow.validate([
  { kind: 'item', title: 'one' },
  { kind: 'item', title: 'two' },
]).ok, false);

const union = compileResultContractValidator({
  kind: 'value',
  value: {
    kind: 'union',
    variants: [
      {
        kind: 'object',
        fields: [
          { name: 'kind', required: true, value: { kind: 'literal', value: 'left' } },
          { name: 'value', required: true, value: { kind: 'string', maxBytes: 8 } },
        ],
        allowExtra: false,
      },
      {
        kind: 'object',
        fields: [
          { name: 'kind', required: true, value: { kind: 'literal', value: 'right' } },
          { name: 'value', required: true, value: { kind: 'boolean' } },
        ],
        allowExtra: false,
      },
    ],
  },
});
assert.equal(union.validate({ kind: 'right', value: true }).ok, true);
assert.equal(union.validate({ kind: 'left', value: true }).ok, false);

const literalUnion = compileResultContractValidator({
  kind: 'value',
  value: {
    kind: 'union',
    variants: [
      { kind: 'literal', value: 'absent' },
      { kind: 'literal', value: 'visible' },
    ],
  },
});
assert.equal(literalUnion.validate('visible').ok, true);
assert.equal(literalUnion.validate('other').ok, false);

const boundedJson = compileResultContractValidator({
  kind: 'value',
  value: { kind: 'json', maxDepth: 1, maxBytes: 1024 * 1024 },
});
assert.equal(
  boundedJson.validate(Array.from({ length: 65_535 }, () => null)).ok,
  true,
  'the JSON root consumes the common node budget exactly once',
);

const exactVector = compileResultContractValidator({
  kind: 'value',
  value: { kind: 'vector', dimensions: 3 },
});
assert.equal(exactVector.validate([0, -0, 3.5]).ok, true);
assert.equal(exactVector.validate([0, 1]).ok, false);
assert.equal(exactVector.validate([0, 1, 2, 3]).ok, false);
assert.equal(exactVector.validate([0, 1, 2 ** 101]).ok, false);

const nestedVectors = compileResultContractValidator({
  kind: 'records',
  rows: { minItems: 0, maxItems: 1_024 },
  record: {
    kind: 'object',
    allowExtra: false,
    fields: [{
      name: 'vector',
      required: true,
      value: { kind: 'vector', dimensions: 64 },
    }],
  },
});
assert.equal(
  nestedVectors.validate(Array.from(
    { length: 1_024 },
    () => ({ vector: Array.from({ length: 64 }, () => 0) }),
  )).ok,
  false,
  'vector components debit the shared result-node budget',
);

for (const malformed of [
  {
    kind: 'value',
    value: { kind: 'union', variants: [{ kind: 'null' }] },
  },
  {
    kind: 'value',
    value: { kind: 'optional', value: { kind: 'string', maxBytes: 8 } },
  },
  {
    kind: 'records',
    record: {
      kind: 'object',
      fields: [
        { name: 'same', required: true, value: { kind: 'boolean' } },
        { name: 'same', required: false, value: { kind: 'null' } },
      ],
      allowExtra: false,
    },
  },
  {
    kind: 'value',
    value: { kind: 'array', items: { kind: 'boolean' }, maxItems: 1 },
  },
  {
    kind: 'value',
    value: { kind: 'vector', dimensions: 0 },
  },
  {
    kind: 'value',
    value: { kind: 'vector', dimensions: 4_097 },
  },
  {
    kind: 'value',
    value: {
      kind: 'union',
      variants: [
        { kind: 'literal', value: 'same' },
        { kind: 'literal', value: 'same' },
      ],
    },
  },
]) {
  assert.throws(
    () => compileResultContractValidator(malformed),
    (error) => error?.code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID',
  );
}

console.log('result-contract-validator.test.mjs: shared closed grammar and value validation pass');
