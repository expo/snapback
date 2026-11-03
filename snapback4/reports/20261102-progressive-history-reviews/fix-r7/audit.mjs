import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { census, awaitBoundary } from '../../../packages/snapback4/test/delivery-fault-instrument.mjs';
import { recipe, fixtureIndex, required, absorbs } from '../../../packages/snapback4/test/delivery-fault-recipes.mjs';
const require = createRequire(new URL('../../../packages/snapback4/package.json', import.meta.url));
const ts = require('typescript');
const baseline = 'f37bdfc0ae'; // Round 4's reviewed census and file split.
function awaits(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), result = [];
  function visit(node) {
    if (ts.isAwaitExpression(node) || ts.isForOfStatement(node) && node.awaitModifier) result.push(node.getText(tree).replace(/\s+/g, ' '));
    ts.forEachChild(node, visit);
  }
  visit(tree); return result;
}
for (const file of ['local.ts', 'local-runtime.ts', 'acquisition.ts']) {
  const path = `packages/snapback4/src/${file}`;
  const before = awaits(file, execFileSync('git', ['show', `${baseline}:snapback4/${path}`], { encoding: 'utf8' }));
  const after = awaits(file, readFileSync(path, 'utf8'));
  assert.deepEqual(after, before, `${file}: every changed await must be classified explicitly`);
  console.log(`await audit: ${file}: ${before.length} -> ${after.length}; 0 new, 0 removed, 0 changed expressions`);
}
const sites = census();
const classified = sites.map((site, index) => ({ index, id: site.id, recipe: recipe(index),
  classification: required.has(fixtureIndex(index)) ? 'required' : 'optional', absorbs: absorbs.has(fixtureIndex(index)) }));
assert.deepEqual(classified, JSON.parse(readFileSync('packages/snapback4/test/delivery-fault-sites.json', 'utf8')));
assert.deepEqual(awaitBoundary(), JSON.parse(readFileSync('packages/snapback4/test/delivery-await-boundary.json', 'utf8')));
const counts = Object.groupBy(classified, site => site.classification);
console.log(`await audit: ${sites.length} classified sites; ${counts.required.length} required, ${counts.optional.length} optional; seals match`);
