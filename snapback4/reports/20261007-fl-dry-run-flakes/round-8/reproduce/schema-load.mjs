import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const file = 'packages/snapback4/test/schema-capability-refusals.test.mjs';
const hash = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = hash();
for (let round = 1; round <= 20; round++) {
  const result = await runFile(file);
  assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(result.counts.pass, 3);
  assert.equal(hash(), before);
  console.log('LOAD_RESULT ' + JSON.stringify({ round, ...result, sourceSha256: before }));
}
