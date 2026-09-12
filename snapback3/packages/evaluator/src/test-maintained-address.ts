// @ref LLP 1001#maintained-addresses — native R2 c4912718 Runtime outputs, copied byte-for-byte.
// Additional absence/forgery/cursor controls below are synthetic, with no new native-output claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FixtureStore as ClientStore } from './test-certificate';
import { canonicalValues, scopedRuleHash, validateIdentity, validateInputs, validateWriteRow, wireJson } from './value-runtime';
import { decodeCursor, decodeCursorFor, encodeCursor } from './cursor';
import { preparePrefix, indexTuple } from './index-store';
import { RowImage, imageCanonical } from './row-image';
import { decodeDeliveryEnvelope, toClosureReceipt, tagWireRow, prepareWireRow, tagWireIndexValues } from '../../snapback3/src/offline-protocol';
import { tagArguments } from '../../snapback3/src/twin-hydrate';
import { decodeHeldProgram } from '../../snapback3/src/held-program';
import { decodeLocalCursor, encodeLocalCursor } from '../../snapback3/src/local-cursor';
import { canonicalSchemaJson } from './certificate-identity';
import { sha256 } from './hash';

const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

for (let i = 1; i <= 4; i++) {
  const w = JSON.parse(readFileSync(new URL(`./test-maintained-fixtures/roundtrip-${i}.json`, import.meta.url), 'utf8'));
  const schema = w.project.schema, ir = w.project.programs.find((p: any) => p.name === w.program);
  const context = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: w.args, now: null, new_ids: [], read_time: null };
  const replay = (receipt: any) => new ClientStore(schema, receipt).reexecute(ir, context, w.certificate);
  assert.equal(replay(w.execution.receipt).state, 'fresh');
  assert.deepEqual(replay(w.execution.receipt).execution.result, w.execution.result);
  assert.deepEqual(
    plainJson(tagArguments(ir.args, Object.fromEntries(Object.entries(w.args).map(([k,v]) => [k,wireJson(v as any)])), schema)),
    w.args,
  );
  const descriptor = { kind: 'query', planHash: w.certificate.plan_hash, ir, certificate: w.certificate };
  const held = { generation: 'a'.repeat(64), schemaHash: w.certificate.schema_hash, schema, programs: { [ir.name]: descriptor } };
  assert(decodeHeldProgram(held)?.programs[ir.name], 'current exact held identity admits the native operation');
  const v4 = structuredClone(held); v4.programs[ir.name].certificate.evaluator_version = 'bounded-spike-rust-search-text-refinements-4';
  assert.equal(decodeHeldProgram(v4)?.programs[ir.name], undefined, 'a cold v4 held operation cannot execute under evaluator v5');
  const forgedPlan = structuredClone(held); forgedPlan.programs[ir.name].ir.name += '.forged';
  assert.equal(decodeHeldProgram(forgedPlan)?.programs[ir.name], undefined);
  if (!w.delivery) continue;
  const envelope = decodeDeliveryEnvelope(w.delivery);
  assert.deepEqual(replay(toClosureReceipt(envelope,schema)).execution.result, w.execution.result);
  const record = w.execution.receipt.rows[0], address = record.id, target = record.table;
  const ref = { Ref: { table: target } }, nested = { Optional: { List: { max: 2, of: { Optional: ref } } } };
  const input = { Array: ['Null', { Id: address }] } as any;
  validateInputs(schema,{ args: { input: nested } },{ input });
  assert.throws(() => validateInputs(schema,{ args: { input: { List: { of: ref,max: 1 } } } },
    { input: { Array: [{ Id: address },{ Id: address }] } }),{ code: 'E_FANOUT' });
  assert.deepEqual(plainJson(tagArguments({ input: nested },{ input: [null,address] },schema)),{ input });
  for (const descriptor of ['Id','Principal','Scalar',{ Json: { max_bytes: 4096 } },{ Ref: { table: 'memberships' } }])
    assert.throws(() => validateInputs(schema,{ args: { input: descriptor } },{ input: { Id: address } }), { code: 'E_INPUT' });
  const link = { Row: { id: { Id: 'link' }, parent: { Id: address }, parents: input } } as any;
  validateWriteRow(schema,'links',link);
  assert.deepEqual(plainJson(tagWireRow(schema,'links',wireJson(link) as any)),link);
  assert.throws(() => new ClientStore(schema,{ ...w.execution.receipt, rows: [{ ...record,id: 'forged' }] }),{ code: 'E_INPUT' });
  const image = RowImage.prepare(schema,target,record.row), first = imageCanonical(image);
  const replacement = structuredClone(record.row); replacement.Row.value = { Int: 2 };
  const store = new ClientStore(schema,w.execution.receipt);
  store.rehydrate({ ...w.execution.receipt, rows: [{ ...record,row: replacement }] });
  assert.equal(imageCanonical(image),first,'a later image cannot mutate the first disclosed image');
  const bad = structuredClone(record.row); bad.Row.principal = { Id: 'different' };
  assert.throws(() => store.rehydrate({ ...w.execution.receipt, rows: [{ ...record,row: bad }] }),{ code: 'E_INPUT' });
  assert.deepEqual(store.byId(target,address),replacement,'failed replacement leaves held rows intact');
  const forged = structuredClone(w.delivery); forged.rows[0].row.principal = 'different';
  const structural = decodeDeliveryEnvelope(forged); // Shape alone is never schema authority.
  assert.throws(() => toClosureReceipt(structural,schema),{ code: 'E_INPUT' });
  for (const invalid of [' '+address,address.replace('"Id"','"String"')]) {
    assert.throws(() => validateInputs(schema,{ args: { input: ref } },{ input: { Id: invalid } }),{ code: 'E_INPUT' });
    assert.throws(() => tagWireIndexValues(schema,target,'byId',[invalid]),{ code: 'E_INPUT' });
  }
  const group = JSON.parse(address); group[0] = { Id: 'b'.repeat(135) };
  const absent = canonicalValues(group), absence = { ...w.execution.receipt, rows: [], absences: [[target,'byId',[{ Id: absent }]]] };
  const absentContext = { ...context,args: { address: { Id: absent } } };
  const negative = new ClientStore(schema,absence).reexecute(ir,absentContext,w.certificate);
  assert.equal(negative.state,'fresh'); assert.equal(negative.execution.result,'Null');
  const unproven = new ClientStore(schema,{ ...absence,absences: [] }).reexecute(ir,absentContext,w.certificate);
  assert.equal(unproven.state,'partial'); assert.equal(unproven.execution.result,'Null');
  assert.equal(preparePrefix(schema,target,'byId',[{ Scalar: { Id: absent } }],[]).length,1);
  assert.deepEqual(indexTuple(schema,target,[{ Column: 'id' }],{ Array: [{ Id: absent }] }),[{ Id: absent }]);
  const position = { table: target,index: 'byId',order: 'Asc' as const,suffix: [{ name: 'id',kind: 'Id' }],values: [{ Id: address }] };
  const cursor = encodeCursor(position);
  assert.deepEqual(decodeCursor(cursor),position);
  assert.deepEqual(decodeCursorFor(cursor,position,schema),{ Array: position.values });
  assert.throws(() => decodeCursorFor(cursor,position),{ code: 'E_INPUT' },'a supplied suffix alone cannot authorize the address');
  const changed = structuredClone(schema); changed.tables[target].indexes.byId.components = [{ Column: 'value' }];
  assert.throws(() => decodeCursorFor(cursor,position,changed),{ code: 'E_INPUT' });
  const fence = { partition: 'alice',operation: ir.name,program: w.certificate.plan_hash,schema: w.certificate.schema_hash,generation: 'a',incarnation: 'first',revisions: [1] };
  const local = encodeLocalCursor(fence,'bound',position);
  assert.equal(decodeLocalCursor(local,fence,'bound',[position],schema),cursor);
  const badPosition = { ...position,values: [{ Id: address.replace('"Id"','"String"') }] };
  const badLocal = encodeLocalCursor(fence,'bound',badPosition);
  assert.throws(() => decodeLocalCursor(badLocal,{ ...fence,revisions: [2] },'bound',[position],schema),
    (error: any) => error.code === 'E_INPUT' && !error.restartLocalPage,'invalid values refuse before stale-page restart');
  assert.throws(() => encodeCursor({ ...position,values: [{ Id: 'x'.repeat(4096) }] }),/4096/);
  const raw = wireJson(record.row) as any;
  assert.deepEqual(plainJson(tagWireRow(schema,target,raw)),record.row);
  assert.equal(imageCanonical(prepareWireRow(schema,target,raw)),first);
}
validateIdentity('a'.repeat(135));
assert.throws(() => validateIdentity('a'.repeat(136)),{ code: 'E_INPUT' });

{
  const index = (columns: string[], unique = false) => ({
    components: columns.map(Column => ({ Column })),
    unique,
  });
  const rules = { read: 'Allow', insert: 'Allow', update: 'Allow', delete: 'Allow' };
  const schema: any = {
    tables: {
      ledger: {
        columns: { id: 'Id', at: 'Time', amount: 'Int' },
        indexes: { byId: index(['id'], true), byAt: index(['at','id']) },
        rules, constraints: [], retain: 'until-revoked',
      },
      balances: {
        columns: { id: 'Id', at: 'Time', value: 'Int' },
        indexes: { byId: index(['id'], true), byAt: index(['at'], true), byValue: index(['value'], true) },
        rules, constraints: [{ Unique: { index: 'byValue' } }], retain: 'until-revoked',
      },
      counts: {
        columns: { id: 'Id', at: 'Time', value: 'Int' },
        indexes: { byId: index(['id'], true) },
        rules, constraints: [], retain: 'until-revoked',
      },
    },
    maintains: [
      { kind: { Sum: { of: 'amount' } }, source: 'ledger', by: ['at'], target: 'balances', readable: 'Allow' },
      { kind: 'Count', source: 'ledger', by: ['at'], target: 'counts', readable: 'Allow' },
    ],
    schedules: [], channels: {}, auth: { password: false, guests: false }, effects: [],
  };
  const schema_hash = sha256(canonicalSchemaJson(schema));
  const source = (id: string, at: number, amount: number): any => ({
    Row: { id: { Id: id }, at: { Int: at }, amount: { Int: amount } },
  });
  const aggregate = (table: string, at: number, value: number): any => ({
    table, id: canonicalValues([{ Int: at }]), row: {
      Row: { id: { Id: canonicalValues([{ Int: at }]) }, at: { Int: at }, value: { Int: value } },
    },
  });
  const context: any = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: {}, now: 1, new_ids: [], read_time: null };
  let serial = 0;
  const mutation = (body: any[]) => ({
    name: `sparse.${serial++}`, kind: 'Mutation', args: {}, read_time_granularity_ms: null,
    body: [...body, { Return: { Literal: 'Null' } }],
  });
  const predict = (rows: any[], absences: any[], body: any[], ranges: any[] = []) => {
    const store = new ClientStore(schema, { schema_hash, rows, ranges, absences, verdicts: [] });
    const result = store.applyMutation(mutation(body), context);
    assert.equal(result.state, 'predicted', JSON.stringify(result));
    lastResult = result;
    return store;
  };
  let lastResult: any;
  const id100 = canonicalValues([{ Int: 100 }]), id200 = canonicalValues([{ Int: 200 }]);
  const absence = (table: string, id: string) => [table, 'byId', [{ Id: id }]];
  const atAbsence = (at: number) => ['balances', 'byAt', [{ Int: at }]];
  const valueAbsence = (value: number) => ['balances', 'byValue', [{ Int: value }]];
  const completeValueRange = (id: string, value: number) => ({
    site: 'test.byValue', table: 'balances', index: 'byValue', prefix: [{ Scalar: { Int: value } }],
    order: 'Asc', take: 10, after: null, before: null, gt: null, gte: null, lt: null, lte: null,
    rule_hash: scopedRuleHash(schema,schema.tables.balances.rules.read), row_ids: [id], stop: 'Exhausted',
    absence: false, halo: null, n2_suffix: null,
  });
  const insert = (row: any) => ({ Insert: { table: 'ledger', row: { Literal: row } } });
  const update = (id: string, patch: any) => ({
    Update: { table: 'ledger', key: { Literal: { Id: id } }, patch: { Literal: { Row: patch } } },
  });
  const remove = (id: string) => ({ Delete: { table: 'ledger', key: { Literal: { Id: id } } } });

  let store = predict(
    [{ table: 'ledger', id: 'a', row: source('a',100,5) }, aggregate('balances',100,5), aggregate('counts',100,1)],
    [],
    [insert(source('b',100,-5))],
  );
  assert.equal(store.byId('balances',id100),null,'nonempty zero sum is sparse');
  assert.equal((wireJson(store.byId('counts',id100)!) as any).value,2);

  store = predict(
    [],
    [absence('ledger','a'),absence('ledger','b'),absence('balances',id100),atAbsence(100),valueAbsence(5),valueAbsence(1),absence('counts',id100)],
    [insert(source('a',100,5)),insert(source('b',100,-5)),update('b',{ amount: { Int: -4 } })],
  );
  assert.equal((wireJson(store.byId('balances',id100)!) as any).value,1);
  const targetWrites = lastResult.execution.writes.filter((write: any) => write.table === 'balances');
  assert.equal(targetWrites.length,1,'insert, sparse delete and reinsert coalesce to one target write');
  assert.equal((wireJson(targetWrites[0].row) as any).value,1);

  store = predict(
    [{ table: 'ledger', id: 'a', row: source('a',100,5) }, { table: 'ledger', id: 'b', row: source('b',100,-5) }, aggregate('counts',100,2)],
    [absence('balances',id100),atAbsence(100),valueAbsence(1)],
    [update('b',{ amount: { Int: -4 } })],
  );
  assert.equal((wireJson(store.byId('balances',id100)!) as any).value,1,'zero to nonzero inserts once');

  store = predict(
    [{ table: 'ledger', id: 'a', row: source('a',100,5) }, { table: 'ledger', id: 'b', row: source('b',100,-4) },
      aggregate('balances',100,1), aggregate('counts',100,2)],
    [absence('balances',id200),atAbsence(200),valueAbsence(5),valueAbsence(-4),absence('counts',id200)],
    [update('b',{ at: { Int: 200 } })],
  );
  assert.equal((wireJson(store.byId('balances',id100)!) as any).value,5);
  assert.equal((wireJson(store.byId('balances',id200)!) as any).value,-4);
  assert.equal((wireJson(store.byId('counts',id100)!) as any).value,1);
  assert.equal((wireJson(store.byId('counts',id200)!) as any).value,1);

  const max = Number.MAX_SAFE_INTEGER;
  for (const [before,after] of [[-max,max],[max,-max]]) {
    store = predict(
      [{ table: 'ledger', id: 'limit', row: source('limit',100,before) }, aggregate('balances',100,before), aggregate('counts',100,1)],
      [valueAbsence(after)],
      [update('limit',{ amount: { Int: after } })],
    );
    assert.equal((wireJson(store.byId('balances',id100)!) as any).value,after,'wide delta is narrowed only after exact coalescing');
  }

  const id300 = canonicalValues([{ Int: 300 }]), id400 = canonicalValues([{ Int: 400 }]);
  const orderedRows = [
      { table: 'ledger', id: 'a', row: source('a',400,1) },
      { table: 'ledger', id: 'b', row: source('b',400,1) },
      { table: 'ledger', id: 'c', row: source('c',300,1) },
      aggregate('balances',400,2), aggregate('balances',300,1),
      aggregate('counts',400,2), aggregate('counts',300,1),
  ];
  const orderedStore = new ClientStore(schema, { schema_hash, rows: orderedRows, ranges: [], absences: [], verdicts: [] });
  assert.throws(
    () => orderedStore.applyMutation(mutation([update('b',{ at: { Int: 300 } })]), context),
    (error: any) => error.code === 'E_CONSTRAINT' && error.message.includes('balances.byValue'),
    'old-group-first target uniqueness refusal matches native',
  );
  assert.equal((wireJson(orderedStore.byId('balances',id400)!) as any).value,2,'refusal rolls back the old group');
  assert.equal((wireJson(orderedStore.byId('balances',id300)!) as any).value,1,'refusal rolls back the destination');

  store = predict(
    [{ table: 'ledger', id: 'move', row: source('move',400,1) }, aggregate('balances',400,1), aggregate('counts',400,1)],
    [absence('balances',id300),atAbsence(300),absence('counts',id300)],
    [update('move',{ at: { Int: 300 } })],
    [completeValueRange(id400,1)],
  );
  assert.equal(store.byId('balances',id400),null,'old sparse group is removed first');
  assert.equal((wireJson(store.byId('balances',id300)!) as any).value,1,'destination reuses the released unique value');

  store = predict(
    [
      { table: 'ledger', id: 'duplicate-delete', row: source('duplicate-delete',200,1) },
      aggregate('balances',100,1), aggregate('balances',200,1), aggregate('counts',200,1),
    ],
    [],
    [remove('duplicate-delete')],
  );
  assert.equal(store.byId('balances',id200),null,'delete does not recheck a stale duplicate unique value');
  assert.notEqual(store.byId('balances',id100),null,'unrelated duplicate survivor remains');

  store = predict(
    [{ table: 'ledger', id: 'b', row: source('b',200,-4) }, aggregate('balances',200,-4), aggregate('counts',200,1)],
    [],
    [remove('b')],
  );
  assert.equal(store.byId('balances',id200),null,'last sum deletion removes target');
  assert.equal(store.byId('counts',id200),null,'last count deletion removes target');
}
console.log('maintained address: exact native held/delivery outputs, targeted Optional/List, absent authority, atomic images and current-schema cursors pass');
