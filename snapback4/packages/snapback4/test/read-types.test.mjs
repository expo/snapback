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
test('AssetState accepts pre-wait loading literals and optional progress from both imports', () => {
  const result = check(`import type { AssetState } from './src/react.tsx';
import type { AssetState as PublishedAssetState } from './dist/react.js';
const initial: AssetState = { status: 'loading' };
const published: PublishedAssetState = initial;
const back: AssetState = published;
const withWait: PublishedAssetState = { status: 'loading', waiting: { stage: 'body', since: 0, diagnosticAt: 5000, received: 1, total: 2 } };
function show(state: AssetState) {
  if (state.status === 'loading') {
    const received: number | undefined = state.waiting?.received;
    return state.waiting?.why?.message ?? state.waiting?.stage ?? 'loading';
  }
  if (state.status === 'ready') return state.url;
  if (state.status === 'error' || state.status === 'denied') return state.why.message;
}`);
  assert.deepEqual(result.codes, [], result.text);
});
test('Astra consumer: a generic row reader accepts Read<T extends Row>', () => {
  const result = check(null, 'consumer.ts');
  assert.deepEqual(result.codes, [], result.text);
});
test('ready literals require the discriminant', () => {
  const result = check(`import type { Read } from './src/contract.ts';
const read: Read<{id: string}> = {data: {id: 'row'}, complete: true, cut: null, fresh: true};`);
  assert.deepEqual(result.codes, [2322], result.text);
});
test('matchRead rejects every omitted state and never falls back for denied or partial', () => {
  for (const missing of ['loading', 'denied', 'absent', 'partial', 'present']) {
    const handlers = ['loading', 'denied', 'absent', 'partial', 'present']
      .filter(state => state !== missing).map(state => `${state}: () => 1`).join(',');
    const result = check(`import { matchRead, type Read } from './dist/contract.js';
declare const read: Read<{id: string} | null>;
matchRead(read, {${handlers}});`);
    assert.deepEqual(result.codes, [2345], result.text);
  }
  for (const handlers of ['otherwise: () => 1', 'denied: () => 1, otherwise: () => 1', 'partial: () => 1, otherwise: () => 1']) {
    const result = check(`import { matchRead, type Read } from './dist/contract.js';
declare const read: Read<unknown>;
matchRead(read, {${handlers}});`);
    assert.deepEqual(result.codes, [2345], result.text);
  }
});
test('matchRead narrows each handler, preserves metadata and infers mixed return types from both imports', () => {
  const result = check(`import { matchRead, type Read, type Ready, type Refusal, type Cursor, type ReadMatchHandlers } from './dist/contract.js';
import { matchRead as reactMatch } from './dist/react.js';
type Row = { id: string };
declare const point: Read<Row | null>, page: Read<readonly Row[]>, maybePage: Read<Row[] | null>;
const matched = matchRead(point, {
  loading: read => { const loading: true = read.loading;
    // @ts-expect-error loading has no ready metadata
    read.fresh;
    return 'loading' as const; },
  denied: (why, read) => { const a: Refusal = why, b: Refusal = read.denied;
    // @ts-expect-error a refusal carries no data
    read.data;
    return false as const; },
  absent: read => { const value: null | (Row & []) = read.data, complete: true = read.complete, cut: null = read.cut; return null; },
  partial: (data, read) => { const value: Row | null = data, arm: 'partial' = read.existence;
    // @ts-expect-error uncertain point data remains nullable
    const certain: Row = data;
    return 42 as const; },
  present: (data, read) => {
    const row: Row = data, arm: 'present' = read.existence, value: Row = read.data;
    const fresh: boolean = read.fresh, revalidating: true | undefined = read.revalidating;
    const complete: boolean = read.complete, next: Cursor | null | undefined = read.next, since: number | undefined = read.since;
    // @ts-expect-error non-null present point
    const nothing: null = data;
    return row;
  },
});
const output: 'loading' | false | null | 42 | Row = matched;
// @ts-expect-error handler results cannot become any
const wrong: number = matched;
const fallback = reactMatch(point, {
  denied: why => why.message,
  partial: (data, read) => { const row: Row | null = data; const arm: 'partial' = read.existence; return false; },
  present: data => data.id,
  otherwise: read => {
    // @ts-expect-error fallback never sees denied
    read.denied;
    if ('data' in read) { const arm: 'absent' | 'present' = read.existence; }
    return null;
  },
});
const fallbackOutput: string | boolean | null = fallback;
matchRead(page, {
  loading: () => 0, denied: () => 0,
  absent: read => { const empty: readonly Row[] & [] = read.data; return 0; },
  partial: (data, read) => { const rows: readonly Row[] = data; return rows.length; },
  present: (data, read) => { const rows: readonly Row[] = data; return rows.length; },
});
matchRead(maybePage, {
  denied: () => 0, partial: data => { const value: Row[] | null = data; return 0; },
  absent: read => { const empty: null | [] = read.data; return 0; },
  present: data => { const rows: Row[] = data; return rows.length; }, otherwise: () => 0,
});
function generic<T>(read: Read<T>) {
  return matchRead(read, { denied: () => undefined, partial: data => { const value: T = data; return value; },
    present: (data, read) => { const value: T = data; const ready: Ready<T> = read; return value; }, otherwise: () => undefined });
}
const typed: ReadMatchHandlers<Row | null, string> = { loading: () => '', denied: why => why.message, absent: () => '', partial: () => '', present: row => row.id };
const named: string = matchRead(point, typed);
// @ts-expect-error a handler cannot widen or replace the read's input type
matchRead(point, { denied: () => '', partial: () => '', present: (value: { other: number }) => value.other, otherwise: () => '' });
`);
  assert.deepEqual(result.codes, [], result.text);
});
test('presentation accepts generic covariant reads and cannot authorize or narrow their data', () => {
  const result = check(`import { readPresentation, type Read, type ReadPresentation } from './dist/contract.js';
function show<T>(read: Read<T>): ReadPresentation { return readPresentation(read); }
declare const read: Read<{id: string} | null>;
const status = show(read);
const pending: boolean = status.pending;
// @ts-expect-error no authority flag
status.safeToMutate;
// @ts-expect-error no saved result
status.data;
if (status.existence === 'present') {
  // @ts-expect-error narrow the original read before accessing data
  read.data.id;
}
`);
  assert.deepEqual(result.codes, [], result.text);
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

test('pending items declarations preserve the row/intent union and typed operation arguments', () => {
  const result = check(`import { usePendingItems, usePendingState } from './dist/react.js';
import type { Mutation, Read } from './dist/contract.js';
declare const send: Mutation<{ id: string; room: string; text: string }, void>;
declare const media: Mutation<{ id: string; room: string; photo: {id: string} }, void>;
const items = usePendingItems({ writes: [send, media], rows: [{ id: 'row', ordinal: 1 }],
  scope: w => w.args.room === 'room', rowKey: r => r.id, intentKey: w => w.args.id });
for (const item of items) {
  if (item.kind === 'row') {
    const n: number = item.row.ordinal;
    // @ts-expect-error rows are not intents
    item.write;
  } else {
    const id: string = item.write.args.id;
    // @ts-expect-error intent cannot invent an ordinal or a row
    item.row.ordinal;
    // @ts-expect-error a mixed operation must narrow its arguments
    item.write.args.photo.id;
  }
}
declare const set: Mutation<{ post: string; set: boolean }, void>;
declare const read: Read<boolean>;
const selected = usePendingState(set, { read, scope: w => w.args.post === 'p', current: false, value: a => a.set });
const b: boolean = selected.value;
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
