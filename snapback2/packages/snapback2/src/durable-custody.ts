// @ref LLP 1018.008.007.002#11-block-index-acquisition-restart —
// bodies, indexes, proofs, cursor and earned receipt packets share one transaction.
import { NativeCoverage } from '../../evaluator/src/native-coverage.js';
import { executeQuery } from '../../evaluator/src/query.js';
import { sha256, isSha256 } from '../../evaluator/src/hash.js';
import { canonicalJson, wireJson } from '../../evaluator/src/value-runtime.js';
import { RowImage } from '../../evaluator/src/row-image.js';
import type { Context, LocalExecution } from '../../evaluator/src/types.js';
import type { SearchExecution } from '../../evaluator/src/search-runtime.js';
import type { HeldProgram } from './store/range-store.js';
import type { NativeCommit, NativeState } from './native-custody.js';
import { DurableRows } from './durable-rows.js';
import { DurableQueryHost, durableProof, type DurableProof } from './durable-query.js';
import { DurableScopes } from './durable-scopes.js';

const bindings = ['principal', 'tokenHash', 'authEpoch', 'generation', 'schemaHash'] as const;
function validateState(state: NativeState, identity: NativeState): void {
  if (!state || bindings.some(name => state[name] !== identity[name])) throw new TypeError('durable custody identity mismatch');
  if (typeof state.sealed !== 'boolean' || !Number.isSafeInteger(state.seq) || state.seq < 0
    || !Number.isSafeInteger(state.serial) || state.serial < 0 || !Number.isSafeInteger(state.readTime)
    || !Number.isSafeInteger(state.revision ?? 0) || (state.revision ?? 0) < 0
    || !state.logs || Array.isArray(state.logs) || !Array.isArray(state.packets)) throw new TypeError('invalid durable custody metadata');
  const ids = new Set<string>();
  for (const packet of state.packets) {
    if (typeof packet.id !== 'string' || !packet.id || packet.id.length > 128 || ids.has(packet.id)
      || typeof packet.log !== 'string' || !Array.isArray(packet.events) || !packet.events.length || packet.events.length > 50
      || packet.events.some(id => typeof id !== 'string') || packet.rejected !== undefined && typeof packet.rejected !== 'string')
      throw new TypeError('invalid durable receipt packet');
    ids.add(packet.id);
  }
  for (const log of Object.values(state.logs)) if (!log || typeof log.exhausted !== 'boolean'
    || log.cursor !== null && typeof log.cursor !== 'string' || !Number.isSafeInteger(log.acquired) || log.acquired < 0)
    throw new TypeError('invalid durable recipient cursor');
}
function coverage(program: HeldProgram, state: NativeState): NativeCoverage {
  const value = new NativeCoverage(program.schema);
  for (const [log, position] of Object.entries(state.logs)) value.admit({ log, recipient: state.principal,
    after: null, cursor: position.cursor, exhausted: position.exhausted });
  return value;
}
function authorityDigests(proof: DurableProof | null | undefined): string[] {
  // A stale, non-digest verdict remains inert evidence, as in ClientStore. It
  // cannot address a generated rule dependency and must not abort row custody.
  return proof ? [...proof.receipt.verdicts.map(verdict => verdict.pinned_inputs_digest).filter(isSha256),
    ...proof.receipt.absences.map(([table, index, key]) => sha256(canonicalJson([table, index, key.map(wireJson)])))] : [];
}
function context(state: NativeState): Context {
  return { viewer: state.principal, principal_kind: 'user', auth_epoch: state.authEpoch,
    args: {}, now: state.readTime, read_time: null, new_ids: [] };
}

/** There is no process-wide row pool or rebuild on open. Query caches die with their transaction. */
export class DurableCustody {
  private failed = false;
  private closed = false;
  private constructor(readonly program: HeldProgram, public state: NativeState, private readonly disk: DurableRows) {}
  static async open(name: string, program: HeldProgram, initial: NativeState): Promise<DurableCustody> {
    const disk = await DurableRows.open(name, program);
    try {
      const state = await disk.transaction('readonly', async tx => {
        const state = await tx.getMeta<NativeState>('state');
        if (!state && (await Promise.all(['pages', 'blocks', 'proofs', 'scopes']
          .map(name => tx.request(tx.idb.objectStore(name).count())))).some(count => count !== 0))
          throw new TypeError('durable partition has rows or proofs without identity metadata');
        return state ?? initial;
      });
      validateState(state, initial);
      if (state.sealed) throw new TypeError('durable custody is sealed');
      coverage(program, state);
      return new DurableCustody(program, state, disk);
    } catch (error) { disk.close(); throw error; }
  }
  private ready(): void {
    if (this.failed || this.closed || this.state.sealed) throw new TypeError('durable custody is not readable');
  }
  async proof(owner: string): Promise<DurableProof | undefined> {
    this.ready();
    return this.disk.transaction('readonly', tx => tx.request(tx.idb.objectStore('proofs').get(owner)));
  }
  async proofOwners(): Promise<string[]> {
    this.ready();
    return this.disk.transaction('readonly', async tx => (await tx.request(tx.idb.objectStore('proofs').getAllKeys())).map(String));
  }
  async commit(change: NativeCommit): Promise<void> {
    this.ready(); validateState(change.state, this.state);
    if (change.state.seq < this.state.seq) throw new TypeError('durable delivery arrived behind its committed sequence');
    const admitted = coverage(this.program, this.state);
    const pages = structuredClone(change.coverage ?? []);
    admitted.validate(pages);
    const next = { ...change.state, revision: (this.state.revision ?? 0) + 1 };
    // Own all mutable metadata before the first carrier await. RowImage owns each body.
    const state = structuredClone(next), proofs = structuredClone(change.proofs ?? {});
    const rows = change.rows.map(row => ({ ...row }));
    try {
      await this.disk.transaction('readwrite', async tx => {
        tx.boundReads(state.seq);
        const previous = await tx.getMeta<NativeState>('state');
        if (previous && (bindings.some(name => previous[name] !== this.state[name])
          || previous.seq !== this.state.seq || (previous.revision ?? 0) !== (this.state.revision ?? 0) || previous.sealed))
          throw new TypeError('durable writer revision changed');
        const changes = await tx.putRows(rows, state.seq, (table, old, next) => admitted.changed(table, old, next));
        // Ordinary query changes invalidate native evidence in the same durable
        // revision as their bodies. Reapply only the actually admitted native
        // pages, after those changes. Dropping a broken chain also resets the
        // scheduler's cursor/progress: reacquisition starts at the root.
        for (const page of pages) admitted.admit(page);
        state.logs = Object.fromEntries(Object.entries(admitted.positions(state.principal)).map(([log, position]) =>
          [log, { ...position, acquired: state.logs[log]?.acquired ?? 0 }]));
        const store = tx.idb.objectStore('proofs');
        const digests = new Set<string>();
        for (const [owner, proof] of Object.entries(proofs)) {
          const old = await tx.request(store.get(owner)) as DurableProof | undefined;
          for (const digest of authorityDigests(old)) digests.add(digest);
          if (!proof) { store.delete(owner); continue; }
          const retained = durableProof(this.program.schema, { ...proof.receipt,
            rows: rows.flatMap(row => row.row ? [{ table: row.table, id: row.id, row: row.row as any }] : []) }, proof.program);
          for (const digest of authorityDigests(retained)) digests.add(digest);
          store.put(retained, owner);
        }
        const scopes = new DurableScopes(tx, context(state));
        const host = await DurableQueryHost.open(tx, state, descriptor => scopes.directory(descriptor));
        await scopes.refresh(changes, host, digests);
        await tx.putMeta('program', this.program);
        await tx.putMeta('state', state);
      });
      this.state = state;
    } catch (error) { this.failed = true; throw error; }
  }
  async execute(op: string, queryContext: Context, search?: SearchExecution): Promise<LocalExecution> {
    this.ready();
    const operation = this.program.programs[op];
    if (!operation || operation.kind !== 'query') throw new TypeError('durable query requires an installed query');
    return this.disk.transaction('readonly', async tx => {
      const state = await tx.getMeta<NativeState>('state') ?? this.state;
      validateState(state, this.state);
      if (state.sealed || (state.revision ?? 0) !== (this.state.revision ?? 0)) throw new TypeError('durable query revision changed');
      const scopes = new DurableScopes(tx, context(state));
      const host = await DurableQueryHost.open(tx, state, descriptor => scopes.directory(descriptor));
      return executeQuery(host, this.program.schema, operation.ir, queryContext, operation.certificate, search);
    });
  }
  /** Diagnostic export is explicit and outside query/acquisition startup. */
  async rows(table: string): Promise<Record<string, unknown>[]> {
    this.ready();
    return this.disk.transaction('readonly', async tx => {
      tx.boundReads(this.state.seq);
      const result: Record<string, unknown>[] = [];
      const cursor = tx.directories.seek();
      try {
        for await (const entry of cursor) {
          const record = entry.value;
          if (!Array.isArray(entry.key) || entry.key.length !== 2 || entry.key[0] !== record.table || entry.key[1] !== record.id)
            throw new TypeError('durable directory key disagrees with its record');
          if (record.table === table) { const row = await tx.row(record); if (row) result.push(RowImage.wire(row)); }
        }
      } finally { await cursor.return?.(); }
      return result;
    });
  }
  close(): void { this.closed = true; this.disk.close(); }
}
