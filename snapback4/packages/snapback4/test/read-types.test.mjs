// @ref LLP 3000.031#3 — covariance and truthful narrowing are reader compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
function check(source, fixture, extension = 'ts', extra = {}) {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const file = fixture ? join(root, 'test/fixtures/read-types', fixture) : join(root, `__read_types.${extension}`);
  const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host);
  host.fileExists = path => Object.hasOwn(extra,path) || exists(path);
  host.readFile = path => path===file && source ? source : Object.hasOwn(extra,path) ? extra[path] : read(path);
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
const withBackoff: PublishedAssetState = { status: 'loading', waiting: { stage: 'backoff', since: 5010, diagnosticAt: 10010,
  interrupted: { stage: 'body', since: 0, diagnosticAt: 4999, progress: 'bytes', received: 0, total: 12,
    why: { code: 'E_ASSET_WAIT', family: 'client', message: 'No observable progress', site: 'useAsset.body' } } } };
const sourceBackoff: AssetState = withBackoff;
function show(state: AssetState) {
  if (state.status === 'loading') {
    const received: number | undefined = state.waiting?.received;
    const progress: 'bytes' | 'unknown' | undefined = state.waiting?.progress;
    const interruptedBytes: number | undefined = state.waiting?.interrupted?.received;
    const interruptedSite: string | undefined = state.waiting?.interrupted?.why.site;
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

test('the card words import from the modules that return them; UseMutation names a hook by its operation', () => {
  const result = check(`import { createClient, type Client, type Principal, type Read, type Write, type Refusal } from './dist/client.js';
import { isReady, isDenied, isLoading, existence, useMutation, type UseMutation, type WriteHook, type MutationHook } from './dist/react.js';
import type { Mutation, Ephemeral, Signal, Query } from './dist/contract.js';
import { createApp, type Client as AppClient } from './dist/app.js';
const client: Client = createClient({ url: 'http://127.0.0.1:4400', persona: 'alice' });
const appClient: AppClient = createApp({ url: 'http://127.0.0.1:4400', persona: 'alice' }).client;
const viewer: Principal | null = client.viewer();
declare const op: Query<{}, { id: string }[]>, add: Mutation<{ body: string }, { id: string }>, typing: Ephemeral<{ room: string }, null>;
const read: Read<{ id: string }[]> = client.observe(op, {}).getSnapshot();
if (isReady(read)) { const rows: { id: string }[] = read.data; }
if (isDenied(read)) { const why: Refusal = read.denied; }
if (!isLoading(read)) existence(read);
function Row({ remove }: { remove: UseMutation<typeof add> }) {
  const hook: WriteHook<{ body: string }, { id: string }> = remove;
  void remove.run({ body: 'x' }, { waitSeconds: 0 }).then((write: Write<{ id: string }>) => {
    if (write.state === 'sent' && !write.replayed) { const id: string = write.result.id; }
    // @ts-expect-error a replayed receipt carries no historical result
    if (write.state === 'sent') write.result.id;
  });
  // @ts-expect-error arguments stay typed through the named hook
  void remove.run({ text: 'x' });
  return null;
}
function useBoth() {
  const durable: UseMutation<typeof add> = useMutation(add);
  const signal: UseMutation<typeof typing> = useMutation(typing);
  const same: MutationHook<{ room: string }, Signal<null>> = signal;
  return [durable, same] as const;
}
`);
  assert.deepEqual(result.codes, [], result.text);
});
// Wave-2 app farm lanes 038 040 056 064 069 081 084 092: the exact shapes that failed.
test('guards take mixed reads and writes; op helpers name rows; React imports the App types; signed-in narrows the viewer', () => {
  const result = check(`import { isDenied, isLoading, isReady, isFailed, sentResult, existence, readPresentation, matchRead, useAuth, type Read, type Write, type ArgsOf, type ResultOf, type RowOf, type App, type AppOptions, type AuthSnapshot, type Cursor, type Principal, type Refusal } from './dist/react.js';
import { createApp } from './dist/app.js';
import type { Query, Mutation, Ephemeral, Act, Signal } from './dist/contract.js';
import type { RowOf as ClientRowOf } from './dist/client.js';
type Lot = { id: string; name: string };
declare const api: { lots: Query<{ c?: Cursor | null }, Lot[]>; lot: Query<{ id: string }, Lot | null>; maybe: Query<{}, Lot[] | null>;
  count: Query<{}, number>; add: Mutation<{ name: string }, string>; remove: Mutation<{ id: string }, null>; typing: Ephemeral<{}, null> };
declare const clients: Read<Lot[]>, crew: Read<{ who: string } | null>, total: Read<number>;
const reads = [clients, crew, total];
const denied = reads.find(isDenied);
if (denied) { const message: string = denied.denied.message; }
const loading: boolean = reads.some(isLoading);
for (const ready of reads.filter(isReady)) { const complete: boolean = ready.complete; const data: Lot[] | { who: string } | null | number = ready.data; }
const shared: Read<unknown>[] = reads;
shared.find(isDenied)?.denied.message;
declare const mixed: Read<Lot[]> | Read<number>;
if (isReady(mixed)) { const data: Lot[] | number = mixed.data; }
else if (isDenied(mixed)) { const why: Refusal = mixed.denied; }
else { const waiting: true = mixed.loading; }
const state: 'loading' | 'denied' | 'present' | 'absent' | 'partial' = existence(mixed);
readPresentation(mixed).incomplete;
if (isReady(clients)) { const rows: Lot[] = clients.data; }
else if (isLoading(clients)) { const waiting: true = clients.loading; }
else { const why: string = clients.denied.message; }
if (!isLoading(crew) && !isDenied(crew)) { const who: { who: string } | null = crew.data; }
matchRead(clients, { denied: why => why.message, partial: rows => rows.length, otherwise: () => 0 });
declare const added: Write<string> | undefined, removed: Write<null> | undefined, signal: Signal<null> | undefined, acted: Act<{ n: number }> | null;
const failed = [added, removed, signal, acted].find(isFailed);
if (failed) { const message: string = failed.why.message; const failedState: 'failed' = failed.state; }
if (isFailed(added)) { const id: string = added.id; }
else if (added?.state === 'sent' && !added.replayed) { const result: string = added.result; }
// @ts-expect-error a read is not a write outcome
isFailed(clients);
// Wave 4 (066, 073): \`state === 'sent'\` alone leaves \`result\` optional (a replay has none); sentResult names the narrowing.
const fresh: string | undefined = sentResult(added);
const cleared: null | undefined = sentResult(removed);
declare const created: Write<{ id: string }>;
const createdId: string | undefined = sentResult(created)?.id;
// @ts-expect-error the result may be absent (pending, failed, replayed)
const certain: string = sentResult(added);
// @ts-expect-error a signal is not a durable write
sentResult(signal);
const row: RowOf<typeof api.lots> = { id: 'a', name: 'n' };
const point: RowOf<typeof api.lot> = row;
const nullablePage: RowOf<typeof api.maybe> = row;
const clientRow: ClientRowOf<typeof api.lots> = row;
const all: ResultOf<typeof api.lots> = [row];
const maybeOne: ResultOf<typeof api.lot> = null;
const args: ArgsOf<typeof api.lot> = { id: 'a' };
const count: ResultOf<typeof api.count> = 1;
const id: ResultOf<typeof api.add> = 'id';
const nothing: ResultOf<typeof api.typing> = null;
// @ts-expect-error RowOf keeps the row's fields required
const partialRow: RowOf<typeof api.lots> = { id: 'a' };
// @ts-expect-error ArgsOf keeps argument names
const wrongArgs: ArgsOf<typeof api.add> = { title: 'x' };
const options: AppOptions = { url: 'http://127.0.0.1:4400', persona: 'alice' };
const app: App = createApp(options);
const snapshot: AuthSnapshot = app.auth.getSnapshot();
if (snapshot.state === 'signed-in') { const who: Principal = snapshot.viewer; }
else { const none: null = snapshot.viewer; }
if (app.auth.state === 'signed-in') { const who: string = app.auth.viewer; }
// @ts-expect-error outside signed-in there is no viewer
if (app.auth.state === 'restoring') { const who: string = app.auth.viewer; }
function Account() {
  const auth = useAuth();
  if (auth.state !== 'signed-in') return auth.why?.message ?? null;
  const who: Principal = auth.viewer;
  return who;
}
`);
  assert.deepEqual(result.codes, [], result.text);
});
// Wave-3 app farm lanes 001 053 063 089: hook results named for props, a
// non-null viewer under a signed-in gate, and a page passed to a guard.
test('UseQuery, UsePage and UseAction name hook results for props; useSignedInViewer is never null', () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { usePage, useQuery, useAction, useViewer, useSignedInViewer, matchRead, isReady, type UsePage, type UseQuery, type UseAction, type PageHook, type ActionHook, type Read, type Act, type Principal, type Cursor } from '${entry}';
import type { Query, FollowingQuery, Mutation, Ephemeral, Action } from './dist/contract.js';
type Row = { id: string; owner: string };
declare const api: { list: Query<{ room: string; c?: Cursor | null }, Row[]>; feed: FollowingQuery<{ c?: Cursor | null }, Row[]>;
  members: Query<{ room: string }, Row[]>; one: Query<{ id: string }, Row | null>; free: Query<{ handle: string }, boolean>; unread: Query<{}, number>;
  invite: Action<{ email: string }, { principal: string }>; send: Mutation<{ body: string }, { id: string }>; typing: Ephemeral<{}, null> };
function More({ page }: { page: UsePage<typeof api.list> }) {
  const rows: Row[] = page.items, more: boolean = page.hasMore, read: Read<Row[]> = page.read;
  return <button disabled={!more} onClick={page.loadMore}>{rows.length}</button>;
}
function Header({ me }: { me: UseQuery<typeof api.one> }) {
  return matchRead(me, { denied: why => why.message, partial: () => '', present: row => row.owner, otherwise: () => '' });
}
function Free({ free }: { free: UseQuery<typeof api.free> }) { return isReady(free) && free.existence === 'present' && free.data ? 'yes' : 'no'; }
function Invite({ invite }: { invite: UseAction<typeof api.invite> }) {
  void invite.run({ email: 'a@b.c' }, { waitSeconds: 0 }).then((outcome: Act<{ principal: string }>) => outcome);
  const last: Act<{ principal: string }> | undefined = invite.last, busy: boolean = invite.inFlight;
  // @ts-expect-error arguments stay typed through the named hook
  void invite.run({ address: 'x' });
  return null;
}
export function Screen() {
  const page = usePage(api.list, { room: 'r' });
  const named: UsePage<typeof api.list> = page, back: typeof page = named, hook: PageHook<Row[]> = page;
  const feed: UsePage<typeof api.feed> = page;
  const members: UseQuery<typeof api.members> = useQuery(api.members, { room: 'r' });
  const unread: UseQuery<typeof api.unread> = useQuery(api.unread, {});
  const count: Read<number> = unread;
  const invite = useAction(api.invite), action: ActionHook<{ email: string }, { principal: string }> = invite;
  const maybe: Principal | null = useViewer();
  const me: Principal = useSignedInViewer();
  const mine = page.items.filter(row => row.owner === me);
  // @ts-expect-error useViewer stays nullable for components that render signed out
  const sure: Principal = useViewer();
  // @ts-expect-error a page query's hook result is not a read
  const notRead: UseQuery<typeof api.list> = page;
  // @ts-expect-error a point query has no page
  const notPage: UsePage<typeof api.one> = page;
  const noQuery: [UseQuery<typeof api.send>, UsePage<typeof api.send>, UseAction<typeof api.send>, UseQuery<typeof api.typing>] = [] as unknown as [never, never, never, never];
  return <><More page={page} /><Header me={useQuery(api.one, { id: 'a' })} /><Free free={useQuery(api.free, { handle: 'h' })} /><Invite invite={invite} />{mine.length}{members && count && maybe}</>;
}
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
});
test('a page passed to a guard fails in one line that names the page type', () => {
  const result = check(`import { isDenied, usePage, type Cursor } from './dist/react.js';
import type { Query } from './dist/contract.js';
declare const api: { list: Query<{ c?: Cursor | null }, { id: string }[]> };
export function Inbox() { const page = usePage(api.list, {}); return isDenied(page) ? null : page.items.length; }
`);
  assert.deepEqual(result.codes, [2345], result.text);
  assert.match(result.text, /'PageHook<\{ id: string; \}\[\]>' is not assignable to parameter of type 'Read<unknown>'/);
});

// Wave 5 (LLP 3000.013 §6.6): 072 and 080 passed hooks to isFailed and met a
// TS2769 overload wall; seven lanes omitted denied/partial beside otherwise.
test('isFailed takes a hook and tests its last outcome; a fallback without denied or partial names the fix', async () => {
  const hooks = check(`import { isFailed, useMutation, useAction, type Write } from './dist/react.js';
import type { Mutation, Action, Ephemeral } from './dist/contract.js';
declare const api: { add: Mutation<{ t: string }, string>; invite: Action<{ who: string }, null>; typing: Ephemeral<{}, null> };
export function Form() {
  const add = useMutation(api.add), remove = useMutation(api.add), invite = useAction(api.invite), typing = useMutation(api.typing);
  const hook = [add, remove, invite, typing].find(isFailed);
  const message: string | undefined = hook?.last.why.message;
  if (isFailed(add)) { const failed: 'failed' = add.last.state; const id: string = add.last.id; }
  const outcome = [add.last, remove.last].find(isFailed);
  const same: string | undefined = outcome?.why.message;
  const write: Write<string> | undefined = add.last;
  // @ts-expect-error a hook narrows its last outcome, not itself: read hook.last.why
  hook?.why;
  return message ?? same ?? write?.state ?? null;
}
`);
  assert.deepEqual(hooks.codes, [], hooks.text);
  for (const [handlers, missing] of [['present: rows => rows.length, otherwise: () => 0', 'denied'], ['denied: why => why.message, present: () => 1, otherwise: () => 0', 'partial']]) {
    const result = check(`import { matchRead, type Read } from './dist/react.js';
declare const read: Read<{ id: string }[]>;
matchRead(read, { ${handlers} });`);
    assert.deepEqual(result.codes, [2345], result.text);
    assert.match(result.text, new RegExp(`Property '${missing}' is missing in type .* but required in type '\\{ ${missing}: "otherwise skips ${missing}: add ${missing}: `), result.text);
  }
  const idiom = check(`import { matchRead, type Read } from './dist/react.js';
declare const read: Read<{ id: string }[]>;
const wait = () => '…';
const shown: number | string = matchRead(read, { present: rows => rows.length, otherwise: wait, denied: wait, partial: wait });
`);
  assert.deepEqual(idiom.codes, [], idiom.text);
  const { isFailed } = await import('../dist/contract.js');
  const why = { code: 'E_RULE', family: 'rule', message: 'no' };
  assert.equal(isFailed({ last: { state: 'failed', id: 'w', why }, inFlight: false }), true);
  assert.equal(isFailed({ last: { state: 'sent', id: 'w', seq: 1, result: null }, inFlight: false }), false);
  assert.equal(isFailed({ last: undefined, inFlight: false }), false);
  assert.equal(isFailed({ state: 'failed', id: 'w', why }), true);
  assert.equal(isFailed(undefined), false);
});

test('sentResult returns a fresh sent result and undefined for every other outcome', async () => {
  const { sentResult } = await import('../dist/contract.js');
  const why = { code: 'E_RULE', family: 'rule', message: 'no' };
  assert.deepEqual(sentResult({ state: 'sent', id: 'w', seq: 1, result: { id: 'r' } }), { id: 'r' });
  assert.equal(sentResult({ state: 'sent', id: 'w', seq: 1, result: null }), null);
  for (const write of [undefined, null, { state: 'pending', id: 'w' }, { state: 'failed', id: 'w', why }, { state: 'sent', id: 'w', seq: 1, replayed: true }]) {
    assert.equal(sentResult(write), undefined);
  }
});

// Wave 6 (045 047 084 094): `present`'s payload printed as `NoInfer<Row[]> &
// ({} | undefined)`, so `rows[0]`, `for…of` and spreading failed (TS7053,
// TS2488) on 0.4.20 and 0.4.21. The data is the read's own non-null type.
test('present and partial payloads index, iterate and destructure like the plain result type', () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { matchRead, useQuery, usePage, type UseQuery, type Cursor } from '${entry}';
import type { Query } from './dist/contract.js';
export type Rows = { categories: { closed: boolean; id: string; name: string; pending?: boolean }; members: { id: string; name: string } };
declare const api: { allCategories: Query<Record<string, never>, Rows["categories"][]>; memberList: Query<{ c?: Cursor | null }, Rows["members"][]>;
  one: Query<{ id: string }, Rows["members"] | null>; frozen: Query<{}, readonly Rows["members"][]>; count: Query<{}, number>; maybe: Query<{}, Rows["members"][] | null> };
function First({ read }: { read: UseQuery<typeof api.allCategories> }) {
  return matchRead(read, { loading: () => 'Loading…', denied: why => why.message, absent: () => 'None',
    partial: rows => rows[0]?.name ?? '…',
    present: rows => {
      const first: Rows["categories"] | undefined = rows[0];
      const [top] = rows, names: string[] = [];
      for (const row of rows) names.push(row.name);
      const copy: Rows["categories"][] = [...rows];
      return [first?.name, top?.name, rows.find(row => row.closed)?.id, rows.at(-1)?.id, copy.length, names.join()].join();
    } });
}
export function Screen() {
  const page = usePage(api.memberList, {});
  const list = matchRead(page.read, { denied: () => 0, partial: rows => rows.length, otherwise: () => 0, present: rows => { let n = 0; for (const row of rows) n += row.name.length; return n + (rows[0]?.id.length ?? 0); } });
  const frozen = matchRead(useQuery(api.frozen, {}), { denied: () => '', partial: () => '', otherwise: () => '', present: rows => rows[0]?.name ?? rows.map(row => row.id).join() });
  const one = matchRead(useQuery(api.one, { id: 'a' }), { denied: () => '', partial: row => row?.name ?? '', otherwise: () => '', present: row => row.name });
  const count = matchRead(useQuery(api.count, {}), { denied: () => 0, partial: n => n, otherwise: () => 0, present: n => n + 1 });
  const maybe = matchRead(useQuery(api.maybe, {}), { denied: () => '', otherwise: () => '', partial: rows => rows?.[0]?.id ?? '',
    present: rows => { const all: Rows["members"][] = rows; return all[0]?.id ?? ''; } });
  const typed: [number, string, string, number, string] = [list, frozen, one, count, maybe];
  return <First read={useQuery(api.allCategories, {})} />;
}
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
});

// Wave 6 (006 009 011 020 024 028 054 068 079 080): shared status helpers had
// no name for "any outcome", and `isFailed` refused the `unknown` that a
// `Promise<unknown>` helper produces. `Outcome` names the union; `isFailed`
// narrows `unknown` and still refuses a read.
test('Outcome names every write, signal and action outcome; isFailed narrows unknown and still refuses reads', async () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { isFailed, useMutation, useAction, type Outcome, type Write, type Act, type Signal, type Read, type Refusal } from '${entry}';
import type { Outcome as ClientOutcome } from './dist/client.js';
import type { Outcome as AppOutcome } from './dist/app.js';
import type { Outcome as ContractOutcome, Mutation, Action, Ephemeral } from './dist/contract.js';
declare const api: { add: Mutation<{ t: string }, { id: string }>; invite: Action<{ who: string }, null>; typing: Ephemeral<{}, null> };
// 080: a helper over Promise<unknown> erased the run() envelope.
async function act(work: Promise<unknown>, report: (message: string) => void) {
  const outcome = await work;
  if (isFailed(outcome)) { const why: Refusal = outcome.why; const id: string = outcome.id; const state: 'failed' = outcome.state; report(why.message); }
}
// The same helper typed by the outcome union keeps every arm.
async function typed(work: Promise<Outcome>) {
  const outcome = await work;
  if (isFailed(outcome)) return outcome.why.message;
  if ('denied' in outcome) return outcome.denied.message;
  const state: 'pending' | 'sent' | 'done' = outcome.state;
  return null;
}
// 006 009 011 054: one notice for every screen, not typed to one table's rows.
function FailText({ of }: { of: readonly (Outcome | undefined)[] }) { return <p role="alert">{of.find(isFailed)?.why.message}</p>; }
function Loose({ last }: { last: unknown }) { return isFailed(last) ? last.why.message : null; }
export function Form() {
  const add = useMutation(api.add), invite = useAction(api.invite), typing = useMutation(api.typing);
  const outcomes: (Outcome | undefined)[] = [add.last, invite.last, typing.last];
  const one: Outcome<{ id: string }> | undefined = add.last;
  const write: Write<{ id: string }> | undefined = add.last;
  void act(add.run({ t: 'x' }), () => {}); void typed(invite.run({ who: 'a' }));
  const anything: any = add.last;
  if (isFailed(anything)) anything.why;
  const same: [ClientOutcome, AppOutcome, ContractOutcome] = [] as unknown as [Outcome, Outcome, Outcome];
  return <><FailText of={outcomes} /><Loose last={invite.last} />{one?.state}{write?.state}{same.length}</>;
}
declare const read: Read<{ id: string }[]>;
// @ts-expect-error a read is not a write outcome
isFailed(read);
// @ts-expect-error a string is not a write outcome
isFailed('failed');
declare const hooks: { last: Write<string> | undefined }[];
const hook = hooks.find(isFailed);
const message: string | undefined = hook?.last.why.message;
// @ts-expect-error a hook narrows its last outcome, not itself
hook?.why;
const loose: unknown[] = [];
const failed = loose.find(isFailed);
const looseMessage: string | undefined = failed?.why.message;
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
  const { isFailed } = await import('../dist/contract.js');
  const why = { code: 'E_RULE', family: 'rule', message: 'no' };
  for (const value of ['failed', 0, true, null, undefined, {}, [], { state: 'sent' }, { last: 'failed' }, { last: null }]) assert.equal(isFailed(value), false, JSON.stringify(value));
  assert.equal(isFailed({ state: 'failed', id: 'w', why }), true);
  assert.equal(isFailed({ last: { state: 'failed', id: 'w', why } }), true);
});

// Wave 6: 14 lanes (60 minutes, six fix-first votes) wrote the same fallback
// three times for denied, partial and otherwise. LLP 3000.031 §8 keeps the
// decision explicit; `...otherwiseAll(fallback)` is that decision in one token.
test('otherwiseAll routes denied, partial and every unnamed state to one fallback, spelled at the call site', async () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { matchRead, otherwiseAll, readPresentation, useQuery, usePage, type Read, type UseQuery, type Cursor, type ReadMatchOtherwiseAll } from '${entry}';
import { otherwiseAll as contractOtherwiseAll } from './dist/contract.js';
import type { Query } from './dist/contract.js';
type Row = { id: string; name: string };
declare const api: { list: Query<{ c?: Cursor | null }, Row[]>; one: Query<{ id: string }, Row | null>; count: Query<{}, number> };
function Status({ read }: { read: Read<unknown> }) { const status = readPresentation(read); return <p role={status.why ? 'alert' : 'status'}>{status.why?.message ?? (status.pending ? 'Loading…' : 'Nothing yet')}</p>; }
export function Screen({ one }: { one: UseQuery<typeof api.one> }) {
  const page = usePage(api.list, {});
  const list = matchRead(page.read, { present: rows => <ul>{rows.map(row => <li key={row.id}>{row.name}</li>)}{rows[0]?.name}</ul>, ...otherwiseAll(read => <Status read={read} />) });
  const name: string = matchRead(one, { present: row => row.name, ...otherwiseAll(() => '…') });
  const count: number | null = matchRead(useQuery(api.count, {}), { present: n => n, absent: () => 0, ...otherwiseAll(() => null) });
  // Written after the spread, an explicit handler wins.
  const why: string = matchRead(one, { ...otherwiseAll(() => ''), denied: refusal => refusal.message, present: row => row.id });
  const same: typeof otherwiseAll = contractOtherwiseAll;
  const handlers: ReadMatchOtherwiseAll<string> = otherwiseAll(() => '');
  return <>{list}{name}{count}{why}{same.length}{handlers.otherwise({ loading: true })}</>;
}
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
  // Wave 7 (R2): the marked fallback only covers what the call leaves unnamed,
  // so a denied or partial written before the spread compiles and wins too.
  const before = check(`import { matchRead, otherwiseAll, type Read } from './dist/react.js';
declare const read: Read<{ id: string }[]>;
const n: number = matchRead(read, { denied: () => 0, partial: rows => rows.length, present: rows => rows.length, ...otherwiseAll(() => 0) });
const m: string = matchRead(read, { partial: rows => rows[0]?.id ?? '', ...otherwiseAll(() => '', { denied: why => why.message, loading: () => '…' }), present: rows => rows[0]?.id ?? '' });`);
  assert.deepEqual(before.codes, [], before.text);
  // A plain otherwise written after the spread replaces the marked fallback,
  // so the explicit denied/partial decisions are required again.
  const replaced = check(`import { matchRead, otherwiseAll, type Read } from './dist/react.js';
declare const read: Read<{ id: string }[]>;
matchRead(read, { ...otherwiseAll(() => 0), present: rows => rows.length, otherwise: () => 0 });`);
  assert.deepEqual(replaced.codes, [2345], replaced.text);
  assert.match(replaced.text, /otherwise skips denied/);
  // Overrides see the read untyped: typed rows belong in the call's own handlers.
  const untyped = check(`import { matchRead, otherwiseAll, type Read } from './dist/react.js';
declare const read: Read<{ id: string }[]>;
matchRead(read, { present: rows => rows.length, ...otherwiseAll(() => 0, { partial: rows => rows.length }) });`);
  assert.deepEqual(untyped.codes, [18046], untyped.text);
  const { matchRead, otherwiseAll } = await import('../dist/contract.js');
  const { readyRead } = await import('../dist/read-existence.js');
  const why = { code: 'E_RULE', family: 'rule', message: 'no' };
  const reads = [{ loading: true }, { denied: why }, readyRead({ data: [], complete: true, cut: null, fresh: true }),
    readyRead({ data: [], complete: false, cut: null, fresh: true }), readyRead({ data: [{ id: 'r' }], complete: true, cut: null, fresh: true })];
  const seen = [];
  const out = reads.map(read => matchRead(read, { present: rows => rows.length, ...otherwiseAll(given => { seen.push(given); return 'fallback'; }) }));
  assert.deepEqual(out, ['fallback', 'fallback', 'fallback', 'fallback', 1]);
  assert.deepEqual(seen, reads.slice(0, 4));
  assert.equal(matchRead(reads[1], { ...otherwiseAll(() => 'fallback'), denied: refusal => refusal.code, present: () => 'present' }), 'E_RULE');
  // Named handlers win in either position; overrides dispatch before the fallback.
  for (const handlers of [{ denied: refusal => refusal.code, partial: () => 'partial', ...otherwiseAll(() => 'fallback') },
    { ...otherwiseAll(() => 'fallback'), denied: refusal => refusal.code, partial: () => 'partial' },
    otherwiseAll(() => 'fallback', { denied: refusal => refusal.code, partial: () => 'partial' })])
    assert.deepEqual(reads.map(read => matchRead(read, handlers)), ['fallback', 'E_RULE', 'fallback', 'partial', 'fallback']);
  // A plain otherwise never receives denial or uncertain emptiness, even untyped.
  assert.throws(() => matchRead(reads[1], { present: () => 'present', otherwise: () => 'fallback' }), /otherwiseAll/);
  assert.throws(() => matchRead(reads[3], { present: () => 'present', otherwise: () => 'fallback' }), /otherwiseAll/);
});

// Wave 7: four lanes wrote matchRead(page); the page hook is matched by its read.
test('matchRead takes a usePage result whole, typed as page.read', async () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { matchRead, otherwiseAll, usePage, type UsePage, type Cursor } from '${entry}';
import type { Query } from './dist/contract.js';
type Row = { id: string; name: string };
declare const api: { list: Query<{ c?: Cursor | null }, Row[]> };
export function List({ more }: { more: UsePage<typeof api.list> }) {
  const page = usePage(api.list, {});
  const names: string = matchRead(page, { ...otherwiseAll(() => ''), present: rows => rows.map(row => row.name).join(), partial: rows => rows[0]?.name ?? '' });
  const count: number = matchRead(more, { loading: () => 0, denied: () => 0, absent: () => 0, partial: rows => rows.length, present: rows => rows.length });
  return <p>{names}{count}</p>;
}
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
  const { matchRead, otherwiseAll } = await import('../dist/contract.js');
  const { readyRead } = await import('../dist/read-existence.js');
  const page = { items: [{ id: 'r' }], hasMore: false, loadMore() {}, read: readyRead({ data: [{ id: 'r' }], complete: true, cut: null, fresh: true }) };
  assert.equal(matchRead(page, { present: rows => rows.length, ...otherwiseAll(() => -1) }), 1);
  assert.equal(matchRead({ ...page, read: { loading: true } }, { present: rows => rows.length, ...otherwiseAll(() => -1) }), -1);
});

// Wave 7 (073, and wave 6's 027 038 092): a read whose arguments do not exist yet.
test('useQuery and usePage take { skip } beside { keep }, and a skipped read is still a Read', () => {
  for (const entry of ['./src/react.tsx', './dist/react.js']) {
    const result = check(`import { matchRead, otherwiseAll, useQuery, usePage, type ReadHookOptions, type Read, type Cursor } from '${entry}';
import type { Query } from './dist/contract.js';
type Row = { id: string; name: string };
declare const api: { list: Query<{ owner: string; c?: Cursor | null }, Row[]>; one: Query<{ id: string }, Row | null> };
export function Detail({ selected }: { selected: string | null }) {
  const options: ReadHookOptions = { skip: !selected, keep: true };
  const one: Read<Row | null> = useQuery(api.one, { id: selected ?? '' }, { skip: !selected });
  const page = usePage(api.list, { owner: selected ?? '' }, options);
  return <p>{matchRead(one, { ...otherwiseAll(() => '…'), present: row => row.name })}{page.items.length}</p>;
}
`, undefined, 'tsx');
    assert.deepEqual(result.codes, [], `${entry}\n${result.text}`);
  }
});

test('matchReadList infers typed list data and mixed returns, while denial remains mandatory', () => {
  const result=check(`import {matchReadList, type Read} from './dist/contract.js';
  declare const read: Read<{id: string}[]>;
  const output=matchReadList(read,{denied: why=>why.message, present: rows=>rows[0]?.id, otherwise: ()=>42});
  const union: string | number | undefined=output;
  matchReadList(read,{denied: why=>why.message, partial: rows=>rows.length, otherwise: ()=>0});
  // @ts-expect-error denial remains explicit for lists
  matchReadList(read,{present: rows=>rows, otherwise: ()=>null});
  declare const point: Read<{id:string}|null>;
  // @ts-expect-error shorthand accepts list reads only
  matchReadList(point,{denied: ()=>null, otherwise: ()=>null});`);
  assert.deepEqual(result.codes,[],result.text);
});

test('guide shared list recipe typechecks against PageHook and WriteHook', async () => {
  const {readFileSync}=await import('node:fs');
  const card=readFileSync(new URL('../CLIENT-AND-OPERATIONS.md',import.meta.url),'utf8');
  const code=card.split('## Shared list and write props')[1].split('```tsx\n')[1].split('```')[0].replace('"snapback4/react"','"./dist/react.js"');
  const result=check(code,undefined,'tsx');assert.deepEqual(result.codes,[],result.text);
  assert.doesNotMatch(card,/members:.*`session`/);
});

test('guide useAuth member list typechecks against the emitted React declaration', async () => {
  const {readFileSync}=await import('node:fs');
  const card=readFileSync(new URL('../../../crates/snapback4-lang/src/guide/client.md',import.meta.url),'utf8');
  const prose=card.split('`useAuth()` members:')[1].split('`signOut()`')[0];
  const members=[...prose.matchAll(/`([a-zA-Z]+)(?:\([^\)]*\))?`/g)].map(match=>match[1]);
  const result=check(`import {useAuth} from './dist/react.js';
  const members: (keyof ReturnType<typeof useAuth>)[] = ${JSON.stringify(members)};
  const auth=useAuth();
  // @ts-expect-error bearer custody remains private
  auth.session;`);
  assert.deepEqual(result.codes,[],result.text);
  assert.equal(members.length,8);
});

test('principal-sharing invitation UI compiles against its actual generated production API', async () => {
  const {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {spawnSync}=await import('node:child_process');
  const {fileURLToPath}=await import('node:url');
  const card=readFileSync(new URL('../../../crates/snapback4-lang/src/guide/production.md',import.meta.url),'utf8');
  const schema=card.split(/```quarry\n/).map(part=>part.split(/```/)[0]).find(part=>part.includes('table profiles:'));
  const dir=mkdtempSync(join(tmpdir(),'surf-invitation-types-'));
  try {
    mkdirSync(join(dir,'snapback'));writeFileSync(join(dir,'snapback/schema.q'),schema);
    const binary=process.env.SNAPBACK4_BIN??fileURLToPath(new URL('../../../target/debug/snapback4',import.meta.url));
    const checked=spawnSync(binary,['check'],{cwd:dir,encoding:'utf8',timeout:30000});
    assert.equal(checked.status,0,checked.stdout+checked.stderr);
    const api=readFileSync(join(dir,'snapback/generated/api.ts'),'utf8');
    const code=card.split('## Invitation UI by shared principal')[1].split(/```tsx\n/)[1].split(/```/)[0]
      .replace('"snapback4/react"','"./dist/react.js"').replace('"../snapback/generated/api"','"./__surf_generated_api.ts"');
    const result=check(code,undefined,'tsx',{[join(root,'__surf_generated_api.ts')]:api});
    assert.deepEqual(result.codes,[],result.text);
  } finally {rmSync(dir,{recursive:true,force:true});}
});


test('isPresent narrows nullable points and mixed read unions from contract and React', () => {
  const result=check(`import {isPresent, type Read} from './dist/contract.js';
import {isPresent as reactPresent} from './dist/react.js';
declare const row: Read<{id:string}|null>;
if(isPresent(row)){ const id:string=row.data.id; }
if(reactPresent(row)){ const id:string=row.data.id; }
declare const mixed: Read<{id:string}|null>|Read<{name:string}|null>;
if(isPresent(mixed)){ const value: {id:string}|{name:string}=mixed.data; }
function generic<T>(read:Read<T|null>){if(isPresent(read)){const value:T=read.data;return value;}}
`);
  assert.deepEqual(result.codes,[],result.text);
});
test('missing denied without otherwise reports its explicit repair', () => {
  const result=check(`import {matchRead,type Read} from './dist/contract.js';
declare const read:Read<{id:string}|null>;
matchRead(read,{loading:()=>0,absent:()=>0,partial:()=>0,present:row=>row.id});`);
  assert.deepEqual(result.codes,[2345],result.text);
  assert.match(result.text,/matchRead requires denied/);
});


test('isPresent classifies only the present arm without changing the read', async () => {
  const {isPresent}=await import('../dist/contract.js');
  for(const read of [{loading:true},{denied:{code:'NO'}},{data:null,existence:'absent'},{data:null,existence:'partial'},{data:[],existence:'partial'}])assert.equal(isPresent(read),false);
  for(const value of [false,0,{id:'one'},['one']])assert.equal(isPresent({data:value,existence:'present'}),true);
});
