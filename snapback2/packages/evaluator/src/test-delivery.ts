import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ClientStore } from './store';
import { canonicalValue } from './value-runtime';
const fixture = JSON.parse(readFileSync(new URL('../../../corpus/deliver-insert-cap3.json', import.meta.url), 'utf8'));
const member = { Exists: { table: 'memberships', index: 'byConversationPrincipal', key: [{ Literal: { Id: 'c1' } }, { Input: 'Viewer' }], provenance: 'Viewer', site: 'member' } };
const required = [{ Let: { name: 'isMember', value: member } }, { Require: { condition: { Variable: 'isMember' }, code: 'MEMBERSHIP_REQUIRED' } }];
const run = (body: any[], predict = true, rows = fixture.receipt.rows) => new ClientStore(fixture.schema, { ...fixture.receipt, rows })
  .applyMutation({ ...fixture.program, body }, { ...fixture.context, now: 100 }, true, null, predict);
const write = fixture.program.body[0];
for (const [label, body, expected] of [
  ['required membership', [...required, write], 1],
  ['no contract', [write], 0],
  ['unused membership', [required[0], write], 0],
  ['other disjunct', [{ Require: { condition: { Binary: { op: 'Or', left: { Literal: { Bool: true } }, right: member } }, code: 'NO' } }, write], 0],
  ['membership changed after require', [...required, { Delete: { table: 'memberships', key: { Literal: { Id: 'a' } } } }, write], 0],
] as const) {
  const result = run(body as any[]);
  assert.equal(result.execution.writes.filter(w => w.table === 'deliveries').length, expected, label);
}
const own = run([...required, write], true, fixture.receipt.rows.slice(0, 1));
assert.equal(own.state, 'predicted');
assert.equal(own.execution.writes.filter(w => w.table === 'deliveries').length, 1, 'an incomplete held audience still predicts exactly the sender');
assert.equal(own.execution.trace.ranges.length, 0, 'no audience scan');
assert.equal(run([...required, write], false).execution.writes.filter(w => w.table === 'deliveries').length, 0, 'receipt-only replay derives no events');
const changes = run([...required, write,
  { Update: { table: 'messages', key: { Literal: { Id: 'm' } }, patch: { Literal: { Row: { body: { String: 'edit' } } } } } },
  { Delete: { table: 'messages', key: { Literal: { Id: 'm' } } } },
]);
assert.deepEqual(changes.execution.writes.filter(w => w.table === 'deliveries').map(w => canonicalValue(w.row!)).length, 1);
// Replay the same frozen pair in the SDK's prediction mode. Normal Rust/TS
// receipt replay above keeps its engine-only delivery exclusion.
for (const contract of [false, true]) {
  const name = contract ? 'deliver-own-membership-contract' : 'deliver-no-membership-contract';
  const c = JSON.parse(readFileSync(new URL(`../../../corpus/${name}.json`, import.meta.url), 'utf8'));
  const result = new ClientStore(c.schema, c.receipt).applyMutation(c.program, c.context, true, c.certificate, true);
  assert.equal(result.state, 'predicted', name);
  assert.equal(result.execution.writes.filter(w => w.table === 'deliveries').length, Number(contract), name);
}
console.log('Delivery prediction checks: 11 passed, 0 failed');
