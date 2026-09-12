import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FixtureStore as ClientStore } from './test-certificate';
import { evaluateCase, compareExpected } from './evaluator';
const fixture = JSON.parse(readFileSync(new URL('../../../corpus/deliver-insert-cap3.json', import.meta.url), 'utf8'));
const member = { Exists: { table: 'memberships', index: 'byConversationPrincipal', key: [{ Literal: { Id: 'c1' } }, { Input: 'Viewer' }], provenance: 'Viewer', site: 'member' } };
const required = [{ Let: { name: 'isMember', value: member } }, { Require: { condition: { Variable: 'isMember' }, code: 'MEMBERSHIP_REQUIRED' } }];
const run = (body: any[], predict = true, rows = fixture.receipt.rows) => new ClientStore(fixture.schema, { ...fixture.receipt, rows })
  .applyMutation({ ...fixture.program, body }, { ...fixture.context, now: 100 }, true, null, predict);
const write = fixture.program.body[0];
let passed = 0, failed = 0;
function check(label: string, body: () => void): void {
  try { body(); passed++; } catch (error) { failed++; console.error(label, error); }
}
for (const [label, body, expected] of [
  ['required membership', [...required, write], 1],
  ['no contract', [write], 0],
  ['unused membership', [required[0], write], 0],
  ['other disjunct', [{ Require: { condition: { Binary: { op: 'Or', left: { Literal: { Bool: true } }, right: member } }, code: 'NO' } }, write], 0],
  ['membership changed after require', [...required, { Delete: { table: 'memberships', key: { Literal: { Id: 'a' } } } }, write], 0],
] as const) {
  check(label, () => {
    const result = run(body as any[]);
    assert.equal(result.execution.writes.filter(w => w.table === 'deliveries').length, expected, label);
  });
}
check('incomplete audience predicts one exact own event without a scan', () => {
  const own = run([...required, write], true, fixture.receipt.rows.slice(0, 1));
  assert.equal(own.state, 'predicted');
  const events = own.execution.writes.filter(w => w.table === 'deliveries');
  assert.equal(events.length, 1);
  const row = (events[0].row as any).Row;
  assert.match(row.id.Id, /^own:[a-f0-9]{64}$/);
  assert.deepEqual([row.recipient,row.kind,row.audience,row.incarnation,row.seq,row.at],
    [{Id:fixture.context.viewer},{String:'delivered'},{Int:0},{Int:0},{Int:100},{Int:100}]);
  assert.equal(own.execution.trace.ranges.length, 0);
});
check('receipt-only replay derives no events', () => {
  assert.equal(run([...required, write], false).execution.writes.filter(w => w.table === 'deliveries').length, 0);
});
check('updates and deletes predict no changed or removed events', () => {
  const changes = run([...required, write,
    { Update: { table: 'messages', key: { Literal: { Id: 'm' } }, patch: { Literal: { Row: { body: { String: 'edit' } } } } } },
    { Delete: { table: 'messages', key: { Literal: { Id: 'm' } } } },
  ]);
  assert.deepEqual(changes.execution.writes.filter(w => w.table === 'deliveries').map(w => (w.row as any).Row.kind), [{String:'delivered'}]);
});
for (const contract of [false, true]) {
  const name = contract ? 'deliver-own-membership-contract' : 'deliver-no-membership-contract';
  check(name, () => {
    const c = JSON.parse(readFileSync(new URL(`../../../corpus/${name}.json`, import.meta.url), 'utf8'));
    assert.equal(c.predictDelivery, true);
    const actual = evaluateCase(c);
    assert.deepEqual(compareExpected(actual, c.expected), []);
    assert.equal(actual.deliveryWrites?.length, Number(contract));
    const tampered = structuredClone(c.expected);
    tampered.deliveryWrites = contract ? [] : [{table:'deliveries',id:'fabricated',row:'Null'}];
    assert(compareExpected(actual,tampered).some(d => d.startsWith('deliveryWrites:')), 'the corpus runner compares predicted writes');
  });
}
console.log(`Delivery prediction checks: ${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} delivery prediction checks failed`);
