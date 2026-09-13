// @ref LLP 1018.008.007.002#10-receipt-groups-and-the-full-application-client —
// ordinary query changes and native page admission publish one durable chain state.
import fixtureJson from '../../../corpus/deliver-log-schema-identity.json';
import { encodeCursor } from '../../evaluator/src/cursor.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import { canonicalJson, schemaDigest } from '../../evaluator/src/value-runtime.js';
import type { CorpusCase } from '../../evaluator/src/types.js';
import { DurableCustody } from '../src/durable-custody.js';
import { decodeNativeAcquisition } from '../src/native-delivery.js';
import type { NativeRow, NativeState } from '../src/native-custody.js';
import type { HeldProgram } from '../src/store/range-store.js';

type Result = { name: string; pass: boolean; error?: string };
const sample = fixtureJson as unknown as CorpusCase, log = 'deliveries', principal = sample.context.viewer;
const program = { schema: sample.schema, schemaHash: schemaDigest(sample.schema), generation: 'durable-native-coverage',
  programs: { log: { kind: 'query', ir: sample.program, certificate: sample.certificate } } } as unknown as HeldProgram;
const initial = (): NativeState => ({ principal, tokenHash: 'coverage-test', authEpoch: sample.context.auth_epoch,
  generation: program.generation, schemaHash: program.schemaHash, seq: 0, readTime: 0, serial: 0,
  sealed: false, logs: {}, packets: [] });
const check = (condition: unknown, message: string): void => { if (!condition) throw Error(message); };
function equal(actual: unknown, expected: unknown, message: string): void {
  check(canonicalJson(actual) === canonicalJson(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
async function refuses(work: Promise<unknown>, pattern: RegExp): Promise<void> {
  try { await work; } catch (error) { check(pattern.test(String(error)), `unexpected refusal ${String(error)}`); return; }
  throw Error(`expected refusal ${pattern}`);
}
const event = (id: string, seq: number, recipient = principal, row = `message-${seq}`) => ({
  id, seq, recipient, row, conversationId: 'c1', incarnation: 0, kind: 'delivered', audience: 1, at: seq,
});
type Event = ReturnType<typeof event>;
const cursor = (row: Event): string => encodeCursor({ table: log, index: 'byRecipient', order: 'Asc',
  suffix: [{ name: 'seq', kind: 'Int' }, { name: 'id', kind: 'Id' }], values: [{ Int: row.seq }, { Id: row.id }] });
function row(body: Event | null, id: string, seq: number): NativeRow {
  return { table: log, id, seq, row: body && RowImage.fromWire(program.schema, log, body,
    message => { throw Error(message); }, program.schemaHash) };
}
async function fixture(run: (control: {
  current(): DurableCustody; reopen(): Promise<void>; native(events: Event[], after?: string | null, end?: string | null): Promise<void>;
  ordinary(events: Array<{ id: string; body: Event | null }>): Promise<void>; state(expected: 'fresh' | 'partial'): Promise<void>;
  name: string;
}) => Promise<void>): Promise<void> {
  const name = `durable-coverage:${crypto.randomUUID()}`, start = initial();
  let custody = await DurableCustody.open(name, program, start);
  try {
    await run({ name, current: () => custody,
      async reopen() { custody.close(); custody = await DurableCustody.open(name, program, start); },
      async native(events, after = custody.state.logs[log]?.cursor ?? null, end = events.length ? cursor(events.at(-1)!) : after) {
        const state = custody.state, seq = Math.max(state.seq + 1, ...events.map(event => event.seq));
        const { change } = decodeNativeAcquisition({ protocol: 1, generation: state.generation, schemaHash: state.schemaHash,
          authority: { principal, authEpoch: state.authEpoch }, log, content: 'messages', seq, readTime: seq,
          rows: events.map(body => ({ table: log, id: body.id, row: body })),
          pages: [{ after, cursor: end, next: null, exhausted: true,
            events: events.map(body => ({ id: body.id, row: body.row, disposition: 'unavailable' })),
            receipt: { ranges: [], absences: [], verdicts: [] } }], receipts: [], more: false },
        { state, program }, log, 'messages', after, []);
        await custody.commit(change);
      },
      async ordinary(events) {
        const seq = custody.state.seq + 1;
        // Point-result row disclosure earns no recipient-range coverage. This is
        // the same shared carrier commit used by an ordinary auxiliary query.
        await custody.commit({ state: { ...custody.state, seq }, rows: events.map(entry => row(entry.body, entry.id, seq)),
          proofs: { auxiliary: { receipt: { ranges: [], absences: [], verdicts: [] } } } });
      },
      async state(expected) { equal((await custody.execute('log', sample.context)).state, expected, 'native query completeness'); },
    });
  } finally { custody.close(); await request(indexedDB.deleteDatabase(name)); }
}

/** Called by the shared browser harness, with no timing or separate owner. */
export async function runDurableCoverageControls(): Promise<Result[]> {
  const results: Result[] = [];
  async function test(name: string, run: () => Promise<void>) {
    try { await run(); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: error instanceof Error ? error.stack : String(error) }); }
  }
  await test('ordinary log append clears exhaustion warm and reopened; native continuation restores it', () => fixture(async f => {
    const first = event('first', 1), second = event('second', 2);
    await f.native([first]); await f.state('fresh');
    await f.ordinary([{ id: first.id, body: first }, { id: 'foreign', body: event('foreign', 2, 'someone-else') }]);
    await f.state('fresh'); await f.reopen(); await f.state('fresh');
    await f.ordinary([{ id: second.id, body: second }]);
    equal(f.current().state.logs[log], { cursor: cursor(first), exhausted: false, acquired: 1 }, 'append retains resumable prefix');
    await f.state('partial'); await f.reopen(); await f.state('partial');
    await f.native([second], cursor(first)); await f.state('fresh');
    equal(f.current().state.logs[log].cursor, cursor(second), 'native continuation advances committed cursor');
    await f.reopen(); await f.state('fresh');
  }));
  for (const loss of [true, false]) await test(`ordinary log ${loss ? 'loss' : 'replacement'} drops chain through reopen and requires root reacquisition`,
    () => fixture(async f => {
      const first = event('first', 1), second = event('second', 2), replacement = event('first', 3, principal, 'replacement-body');
      await f.native([first, second]);
      await f.ordinary([{ id: first.id, body: loss ? null : replacement }]);
      check(!Object.hasOwn(f.current().state.logs, log), 'broken chain and its progress must be removed');
      await f.state('partial'); await f.reopen(); await f.state('partial');
      await refuses(f.native([], cursor(second)), /contiguous/);
      await f.state('partial');
      await f.native(loss ? [second] : [second, replacement], null); await f.state('fresh');
      equal(f.current().state.logs[log].acquired, loss ? 1 : 2, 'reacquisition counts its new prefix');
      await f.reopen(); await f.state('fresh');
    }));
  await test('root native page reapplies coverage after its same-transaction replacement; late abort preserves old chain',
    () => fixture(async f => {
      const first = event('first', 1), replacement = event('first', 2, principal, 'new-body');
      await f.native([first]);
      await f.native([replacement], null); await f.state('fresh'); await f.reopen(); await f.state('fresh');
      const before = structuredClone(f.current().state), original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
        if (this.transaction.db.name === f.name && this.name === 'meta' && args[1] === 'state') throw Error('coverage state abort');
        return original.apply(this, args);
      };
      try { await refuses(f.ordinary([{ id: first.id, body: null }]), /coverage state abort/); }
      finally { IDBObjectStore.prototype.put = original; }
      equal(f.current().state, before, 'aborted invalidation must not publish metadata');
      await f.reopen(); await f.state('fresh');
      equal((await f.current().rows(log))[0].row, replacement.row, 'aborted row loss must roll back');
    }));
  await test('append to an exhausted empty log drops its empty prefix and reacquires from root', () => fixture(async f => {
    await f.native([]); await f.state('fresh');
    const first = event('first', 1);
    await f.ordinary([{ id: first.id, body: first }]);
    check(!Object.hasOwn(f.current().state.logs, log), 'empty invalidated prefix must not masquerade as a native page');
    await f.reopen(); await f.state('partial');
    await f.native([first]); await f.state('fresh');
  }));
  return results;
}
