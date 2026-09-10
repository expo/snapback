// P0 experiment only: no production Table.deliver or prediction hook is installed.
// @ref LLP 1019#7-the-twin — custody prediction is the sender's own delivered event, never an audience guess.
import assert from 'node:assert/strict';
import { canonicalProgramJson, canonicalSchemaJson } from './certificate-identity';
import { ClientStore } from './store';
import { Runner } from './runner';
import type { Context, Value } from './types';

const index = (columns: string[], unique = false) => ({ components: columns.map(Column => ({ Column })), unique });
const table = (columns: any, rules: any) => ({ columns, indexes: { byId: index(['id'], true) }, rules, constraints: [], retain: 'until-revoked' });
const own = { Eq: [{ Field: 'authorId' }, 'Viewer'] };
const schema: any = { tables: {
  messages: table({ id: 'Id', authorId: 'Principal', conversationId: 'Id', body: { Text: { max: 4000 } } },
    { read: 'Allow', insert: own, update: own, delete: own }),
  deliveries: table({ id: 'Id', recipient: 'Principal', row: { Ref: { table: 'messages' } }, kind: { Enum: { variants: ['delivered', 'changed', 'removed'] } } },
    { read: { Eq: [{ Field: 'recipient' }, 'Viewer'] }, insert: 'Deny', update: 'Deny', delete: 'Deny' }),
}, maintains: [] };
const empty = { rows: [], ranges: [], absences: [], verdicts: [] };
const context: Context = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
const message: Value = { Row: { id: { Id: 'm' }, authorId: { Id: 'alice' }, conversationId: { Id: 'c' }, body: { String: 'hello' } } };
const ownEvent: Value = { Row: { id: { Id: 'predicted-m-alice' }, recipient: { Id: 'alice' }, row: { Id: 'm' }, kind: { String: 'delivered' } } };
const program = (body: any[]) => ({ name: 'send', kind: 'Mutation', args: {}, read_time_granularity_ms: null, body });
const send = { Insert: { table: 'messages', row: { Literal: message } } };

assert.doesNotThrow(() => canonicalSchemaJson(schema));
const declared = structuredClone(schema);
declared.tables.messages.deliver = { target: 'memberships', prefix: ['conversationId'], log: 'deliveries', audience: 3 };
assert.throws(() => canonicalSchemaJson(declared), { code: 'E_SCHEMA' });
console.log('P0 twin identity: ordinary private table accepted; Table.deliver -> E_SCHEMA');

{
  const store = new ClientStore(schema, empty);
  const result = new Runner(store, schema, context, null).execute(program([send]));
  assert.deepEqual(result.writes.map(w => w.table), ['messages']);
  const generated = program([send, { If: {
    condition: { Binary: { op: 'Eq', left: { Literal: { String: 'P0 generated delivery block' } }, right: { Literal: { String: 'P0 generated delivery block' } } } },
    then_body: [{ Insert: { table: 'deliveries', row: { Literal: ownEvent } } }], else_body: [],
  } }]);
  assert.doesNotThrow(() => canonicalProgramJson(generated));
  assert.throws(() => new Runner(new ClientStore(schema, empty), schema, context, null).execute(generated), { code: 'E_RULE' });
  console.log('P0 twin unchanged runner: messages only; ordinary AOT private log insert -> E_RULE');
}

{
  // Prototype the same narrow derived-write slot maintain uses. Monkey-patching
  // here keeps this experiment out of the bundled evaluator. The production
  // hook must also choose a stable provisional identity/order and pass the
  // outbox's atomic overlay boundary; this is a Runner experiment, not that claim.
  const store = new ClientStore(schema, empty);
  const runner = new Runner(store, schema, context, null);
  const internal = runner as any;
  const insert = internal.insert.bind(runner);
  internal.insert = (table: string, row: Value, ifAbsent = false) => {
    const inserted = insert(table, row, ifAbsent);
    if (inserted && table === 'messages') {
      store.put('deliveries', ownEvent);
      internal.recordWrite('deliveries', ownEvent);
    }
    return inserted;
  };
  const result = runner.execute(program([send,
    { Update: { table: 'messages', key: { Literal: { Id: 'm' } }, patch: { Object: { body: { Literal: { String: 'edited' } } } } } },
    { Delete: { table: 'messages', key: { Literal: { Id: 'm' } } } },
  ]));
  const predicted = result.writes.filter(w => w.table === 'deliveries');
  assert.equal(predicted.length, 1);
  assert.deepEqual(predicted[0]!.row, ownEvent);
  assert.deepEqual(runner.coverageMisses(), []);
  console.log('P0 twin derived slot: 1 own delivered, 0 changed, 0 removed, no audience receipt');
}
console.log('P0 twin: 3 experiments passed');
