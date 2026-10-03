// @ref LLP 3000.031#3 — covariance and truthful narrowing are reader compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
function check(source, fixture) {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const file = fixture ? join(root, 'test/fixtures/read-types', fixture) : join(root, '__read_types.ts');
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host);
  if (source) host.readFile = path => path === file ? source : read(path);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  return { codes: diagnostics.map(d => d.code), text: ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: file => file, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }) };
}
test('Astra consumer: a generic row reader accepts Read<T extends Row>', () => {
  const result = check(null, 'consumer.ts');
  assert.deepEqual(result.codes, [], result.text);
});
test('ready literals require the discriminant', () => {
  const result = check(`import type { Read } from './src/contract.ts';
const read: Read<{id: string}> = {data: {id: 'row'}, complete: true, cut: null, fresh: true};`);
  assert.deepEqual(result.codes, [2322], result.text);
});
test('awaited query excludes loading, including existence, while observe retains it', () => {
  const result = check(`import { existence, type Client, type Query, type SettledRead, type Read } from './src/contract.ts';
declare const client: Client, op: Query<{}, { id: string } | null>;
async function consumer() {
  const read = await client.query(op, {});
  const settled: SettledRead<{ id: string } | null> = read;
  const state: 'present' | 'absent' | 'partial' | 'denied' = existence(read);
  type Loading = Extract<typeof read, { loading: true }>;
  // @ts-expect-error no loading value can inhabit the settled type
  const impossible: Loading = { loading: true };
  // @ts-expect-error existence cannot be loading after an await
  if (existence(read) === 'loading') throw Error('unreachable');
  const observed: Read<unknown> = client.observe(op, {}).getSnapshot();
  const all: 'loading' | 'present' | 'absent' | 'partial' | 'denied' = existence(observed);
  if ('denied' in read) return read.denied;
  return read.data;
}`);
  assert.deepEqual(result.codes, [], result.text);
});
test('Astra nullable consumer: absent arrays cannot be assigned to null', () => {
  const result = check(null, 'nullable-consumer.ts');
  assert.deepEqual(result.codes, [2322], result.text);
});
test('Read is covariant and every narrowed arm retains its result type', () => {
  const result = check(`import { isReady, type Read } from './src/contract.ts';
type Row = { id: string };
// A structural row can also be an empty array. This is why absent point
// narrowing must retain Row & [] when all subtype widening remains valid.
const arrayWithId: Row & [] = Object.assign([] as [], { id: 'empty' });
const emptySubtype: Read<Row & []> = { data: arrayWithId, existence: 'absent', complete: true, cut: null, fresh: true };
const structuralPoint: Read<Row | null> = emptySubtype;
function widen<U, T extends U>(read: Read<T>): Read<U> { return read; }
function nullable<T>(read: Read<T>): Read<T | null> { return read; }
function unknown<T>(read: Read<T>): Read<unknown> { return read; }
function ready<T>(read: Read<T>) { if (isReady(read)) { const value: T = read.data; } }
function point(read: Read<Row | null>) {
  if (!isReady(read)) return;
  switch (read.existence) {
    case 'present': { const row: Row = read.data; break; }
    case 'absent': { const empty: null | (Row & []) = read.data; const complete: true = read.complete; const cut: null = read.cut; break; }
    case 'partial': { const value: Row | null = read.data; break; }
  }
}
function arrays<T extends readonly Row[]>(read: Read<T>) {
  if (!isReady(read)) return;
  switch (read.existence) {
    case 'present': { const rows: T = read.data; break; }
    case 'absent': { const rows: T = read.data; break; }
    case 'partial': { const rows: T = read.data; break; }
  }
}
function maybeArray(read: Read<Row[] | null>) {
  if (!isReady(read)) return;
  switch (read.existence) {
    case 'present': { const rows: Row[] = read.data; break; }
    case 'absent': { const empty: null | [] = read.data; break; }
    case 'partial': { const value: Row[] | null = read.data; break; }
  }
}
function scalar(read: Read<boolean | number | string | undefined>) {
  if (!isReady(read)) return;
  const value: boolean | number | string | undefined = read.data;
  if (read.existence === 'absent') { const empty: null | [] = read.data; }
}
`);
  assert.deepEqual(result.codes, [], result.text);
});

test('receipt family preserves mapped operation types and useSeen requires explicit visibility', () => {
  const result = check(`import type { Client, ReceiptFamily } from './src/contract.ts';
import { useSeen } from './src/react.tsx';
type Member = {id:string; joined:number; received:number; viewed:number; pending?:boolean};
declare const family: ReceiptFamily<Member, 'room', 'to'>, client: Client;
client.query(family.member, {room:'r'});
client.mutate(family.seen, {room:'r',to:4});
// @ts-expect-error declared argument names, not guessed defaults
client.mutate(family.seen, {conversation:'r',through:4});
// @ts-expect-error member scope must be an ID string
client.query(family.member, {room:3});
// @ts-expect-error foreground/visibility is never assumed
useSeen(family, {scope:'r',through:4});
const state = useSeen(family, {scope:'r',through:null,active:false});
state.retry();
// @ts-expect-error seen reports no delivered watermark
state.delivered;
`);
  assert.deepEqual(result.codes, [], result.text);
});
