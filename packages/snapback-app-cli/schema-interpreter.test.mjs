import assert from 'node:assert/strict';

import { compileInertSchema } from './schema-interpreter.mjs';

const validate = compileInertSchema({
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1 },
    count: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
    tags: { type: 'array', items: { enum: ['a', 'b'] }, maxItems: 2 },
  },
  required: ['title'],
});
assert.equal(validate({ title: 'hello', count: 2, tags: ['a'] }), true);
assert.equal(validate({ title: '', surprise: true }), false);
assert.deepEqual(validate.errors, [{ instancePath: '/title', keyword: 'minLength' }]);
assert.equal(validate({ title: 'hello', surprise: true }), false);
assert.deepEqual(validate.errors, [{ instancePath: '/surprise', keyword: 'additionalProperties' }]);

const localRef = compileInertSchema({
  $defs: { label: { type: 'string' } },
  type: 'array',
  items: { $ref: '#/$defs/label' },
});
assert.equal(localRef(['one', 'two']), true);
assert.equal(localRef(['one', 2]), false);
assert.deepEqual(localRef.errors, [{ instancePath: '/1', keyword: 'type' }]);

assert.throws(() => compileInertSchema({ $ref: 'https://example.test/schema' }), /external or malformed/);
assert.throws(() => compileInertSchema({ patternProperties: {} }), /unsupported schema keyword/);

console.log('schema-interpreter.test.mjs: all cases passed');
