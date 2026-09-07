// @ref LLP 1001#maintained-addresses — native R2 c4912718 Runtime outputs, copied byte-for-byte.
// Additional absence/forgery/cursor controls below are synthetic, with no new native-output claim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ClientStore } from './store';
import { canonicalValues, validateIdentity, validateInputs, validateWriteRow, wireJson } from './value-runtime';
import { decodeCursor, decodeCursorFor, encodeCursor } from './cursor';
import { preparePrefix, indexTuple } from './index-store';
import { RowImage, imageCanonical } from './row-image';
import { decodeDeliveryEnvelope, toClosureReceipt, tagWireRow, prepareWireRow, tagWireIndexValues } from '../../snapback2/src/offline-protocol';
import { tagArguments } from '../../snapback2/src/twin-hydrate';
import { decodeHeldProgram } from '../../snapback2/src/held-program';
import { decodeLocalCursor, encodeLocalCursor } from '../../snapback2/src/local-cursor';

for (let i = 1; i <= 4; i++) {
  const w = JSON.parse(readFileSync(new URL(`./test-maintained-fixtures/roundtrip-${i}.json`, import.meta.url), 'utf8'));
  const schema = w.project.schema, ir = w.project.programs.find((p: any) => p.name === w.program);
  const context = { viewer: 'alice', principal_kind: 'user', auth_epoch: 1, args: w.args, now: null, new_ids: [], read_time: null };
  const replay = (receipt: any) => new ClientStore(schema, receipt).reexecute(ir, context, w.certificate);
  assert.equal(replay(w.execution.receipt).state, 'fresh');
  assert.deepEqual(replay(w.execution.receipt).execution.result, w.execution.result);
  assert.deepEqual(tagArguments(ir.args, Object.fromEntries(Object.entries(w.args).map(([k,v]) => [k,wireJson(v as any)])), schema), w.args);
  const descriptor = { kind: 'query', planHash: w.certificate.plan_hash, ir, certificate: w.certificate };
  const held = { generation: 'a'.repeat(64), schemaHash: w.certificate.schema_hash, schema, programs: { [ir.name]: descriptor } };
  assert(decodeHeldProgram(held)?.programs[ir.name], 'current exact held identity admits the native operation');
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
  assert.deepEqual(tagArguments({ input: nested },{ input: [null,address] },schema),{ input });
  for (const descriptor of ['Id','Principal','Scalar',{ Json: { max_bytes: 4096 } },{ Ref: { table: 'memberships' } }])
    assert.throws(() => validateInputs(schema,{ args: { input: descriptor } },{ input: { Id: address } }), { code: 'E_INPUT' });
  const link = { Row: { id: { Id: 'link' }, parent: { Id: address }, parents: input } } as any;
  validateWriteRow(schema,'links',link);
  assert.deepEqual(tagWireRow(schema,'links',wireJson(link) as any),link);
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
  assert.deepEqual(tagWireRow(schema,target,raw),record.row);
  assert.equal(imageCanonical(prepareWireRow(schema,target,raw)),first);
}
validateIdentity('a'.repeat(135));
assert.throws(() => validateIdentity('a'.repeat(136)),{ code: 'E_INPUT' });
console.log('maintained address: exact native held/delivery outputs, targeted Optional/List, absent authority, atomic images and current-schema cursors pass');
