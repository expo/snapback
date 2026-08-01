// Golden canonical-form vectors for FunctionArgsContractV1 and its v2
// witness (LLP 0131 acceptance 6 and 7).
//
// The pinned hashes are the committed witness fixture: they change when (and
// only when) a bound or node in the canonical descriptor changes. The vector
// set deliberately includes the canonicalization-sensitive cases — finite-
// real bounds and numeric literals — plus every legacy-alias normalization:
// v.real()/v.number() → finiteReal, v.relationIncarnationOf → string with
// the materialized profile-maximum bound (asserted witness-identical to
// v.string(), the accepted consequence LLP 0131 names), and v.optional →
// required: false.

import assert from 'node:assert/strict';

import { v } from './define.mjs';
import {
  argsContractHash,
  effectiveArgsContract,
} from './result-contracts.mjs';

function golden(name, args, expectedContract, expectedHash) {
  const contract = effectiveArgsContract(args);
  assert.deepEqual(
    contract,
    expectedContract,
    `${name}: canonical descriptor drifted`,
  );
  assert.equal(
    argsContractHash(contract),
    expectedHash,
    `${name}: v2 witness drifted — a bound or node in the canonical descriptor changed`,
  );
}

// Empty declared root: still a closed object with a stable witness.
golden(
  'empty-root',
  {},
  { fields: [] },
  'sha256:2ed03ebf770f260ecd637e5f3309b67cf21119731f97265c55332273c25272ac',
);

// Every node kind, every bound, declaration order preserved.
golden(
  'every-node-kind',
  {
    title: v.string({ maxBytes: 128 }),
    done: v.boolean(),
    count: v.integer({ min: 0, max: 100 }),
    ratio: v.finiteReal({ min: -1.5, max: 1.5 }),
    owner: v.principal(),
    row: v.id('rows'),
    mode: v.union([v.literal('even'), v.literal('manual')]),
    zero: v.literal(0.5),
    nothing: v.null(),
    blob: v.json({ maxDepth: 4, maxBytes: 1024 }),
    splits: v.array(v.object({
      participant: v.string(),
      amountCents: v.integer(),
      note: v.optional(v.string({ maxBytes: 64 })),
    }), { maxItems: 16 }),
  },
  {
    fields: [
      { name: 'title', required: true, value: { kind: 'string', maxBytes: 128 } },
      { name: 'done', required: true, value: { kind: 'boolean' } },
      { name: 'count', required: true, value: { kind: 'integer', min: 0, max: 100 } },
      { name: 'ratio', required: true, value: { kind: 'finiteReal', min: -1.5, max: 1.5 } },
      { name: 'owner', required: true, value: { kind: 'principal' } },
      { name: 'row', required: true, value: { kind: 'id', table: 'rows' } },
      {
        name: 'mode',
        required: true,
        value: {
          kind: 'union',
          variants: [
            { kind: 'literal', value: 'even' },
            { kind: 'literal', value: 'manual' },
          ],
        },
      },
      { name: 'zero', required: true, value: { kind: 'literal', value: 0.5 } },
      { name: 'nothing', required: true, value: { kind: 'null' } },
      { name: 'blob', required: true, value: { kind: 'json', maxDepth: 4, maxBytes: 1024 } },
      {
        name: 'splits',
        required: true,
        value: {
          kind: 'array',
          maxItems: 16,
          element: {
            kind: 'object',
            allowExtra: false,
            fields: [
              { name: 'participant', required: true, value: { kind: 'string', maxBytes: 1048576 } },
              { name: 'amountCents', required: true, value: { kind: 'integer', min: -9007199254740991, max: 9007199254740991 } },
              { name: 'note', required: false, value: { kind: 'string', maxBytes: 64 } },
            ],
          },
        },
      },
    ],
  },
  'sha256:ff03e0c25f4b4d847a149ba49cc2e648fe496fdc292f67ce98ebcd5a336057d7',
);

// Legacy aliases: v.real() and v.number() both emit the finiteReal node with
// materialized profile bounds — witness-identical to each other.
const realContract = effectiveArgsContract({ ratio: v.real() });
const numberContract = effectiveArgsContract({ ratio: v.number() });
assert.deepEqual(realContract, numberContract);
assert.equal(realContract.fields[0].value.kind, 'finiteReal');
assert.equal(argsContractHash(realContract), argsContractHash(numberContract));

// Relation incarnation normalizes to the string node with the materialized
// profile-maximum bound — witness-identical to v.string() (the accepted
// consequence: incarnation-ness lives in the schema and relation machinery,
// not the args contract).
const incarnation = effectiveArgsContract({
  token: v.relationIncarnationOf({ foreignKeyField: 'parentId', parentTable: 'parents' }),
});
const plainString = effectiveArgsContract({ token: v.string() });
assert.deepEqual(incarnation, plainString);
assert.deepEqual(incarnation.fields[0].value, { kind: 'string', maxBytes: 1048576 });
assert.equal(argsContractHash(incarnation), argsContractHash(plainString));

// The witness moves when (and only when) a bound or node changes.
const narrow = effectiveArgsContract({ title: v.string({ maxBytes: 64 }) });
const wide = effectiveArgsContract({ title: v.string({ maxBytes: 65 }) });
assert.notEqual(argsContractHash(narrow), argsContractHash(wide));
assert.equal(
  argsContractHash(effectiveArgsContract({ title: v.string({ maxBytes: 64 }) })),
  argsContractHash(narrow),
);

assert.throws(
  () => effectiveArgsContract({ photo: v.assetRef() }),
  /v\.assetRef\(\) is a stored\/result validator, not an argument validator/u,
  'adding AssetRef to result contracts must not silently widen operation arguments',
);

console.log('args-contract goldens: canonical form and v2 witness pinned');
