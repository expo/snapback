// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — immutable positive assertions seek by sequence and typed extent, including after body GC.
import { HeldIndex, components } from '../../../evaluator/src/index-store.js';
import type { ExtentCondition, KeyImage } from './extent-facts.js';
export interface IndexedFact { id: string; key: string; table: string; rowId: string; seq: number; digest: string; keys?: KeyImage; refs: number }
type Entry = IndexedFact & { namespace: number };
type IndexSlot = { index: HeldIndex<Entry>; ready: boolean; owners: number };
type SharedIndexes = { indexes: Map<string, IndexSlot>; members: Set<FactIndex> };

/** Refcounts are supplied by existing durable guards/proofs (or current rows for
 * the live index). No indexed entry or token path survives its last owner. */
export class FactIndex {
  private shared: SharedIndexes;
  private records = new Map<string, Entry>();
  private missing = new Map<string, Set<string>>();
  constructor(private schema: any, private partitioned: boolean, shared?: FactIndex) {
    this.shared = shared?.shared ?? { indexes: new Map(), members: new Set() }; this.shared.members.add(this);
  }
  private postingId(id: string): string { return `${this.partitioned ? 'p' : 'l'}${id}`; }
  get(id: string): IndexedFact | undefined { return this.records.get(id); }
  change(fact: Omit<IndexedFact,'refs'>, delta: number): void {
    if (!this.schema) fact = { ...fact,keys: undefined };
    const old = this.records.get(fact.id);
    if (old) {
      if (!old.keys && fact.keys && old.refs + delta > 0) {
        const refs = old.refs + delta; this.change(old,-old.refs); this.change(fact,refs); return;
      }
      old.refs += delta;
      if (old.refs) return;
      this.records.delete(fact.id);
      if (!old.keys) {
        const key = `${old.table}\0${old.seq}`, set = this.missing.get(key)!; set.delete(old.id);
        if (!set.size) this.missing.delete(key);
      } else for (const name of Object.keys(old.keys)) {
        const key = `${old.table}\0${name}`, slot = this.shared.indexes.get(key)!;
        if (slot.ready) slot.index.remove(this.postingId(old.id));
        if (!--slot.owners) this.shared.indexes.delete(key);
      }
      return;
    }
    if (delta < 0) throw new TypeError('missing indexed fact reference');
    // The live namespace is internal metadata; it never becomes an application index Value.
    const record = { ...fact, refs: delta,namespace: this.partitioned ? fact.seq : -1 }; this.records.set(fact.id,record);
    if (!fact.keys) {
      const key = `${fact.table}\0${fact.seq}`, set = this.missing.get(key) ?? new Set(); set.add(fact.id); this.missing.set(key,set); return;
    }
    for (const [name,parts] of Object.entries(fact.keys)) {
      const key = `${fact.table}\0${name}`;
      let slot = this.shared.indexes.get(key);
      if (!slot) {
        slot = { index: new HeldIndex<Entry>(this.schema,fact.table,name,components(this.schema,fact.table,name), row => row.namespace), ready: false, owners: 0 };
        this.shared.indexes.set(key,slot);
      }
      // Validate on admission just as an eager insertion does, including cold malformed keys.
      if (slot.ready) slot.index.putPrepared(this.postingId(fact.id),record,parts);
      else slot.index.validatePrepared(parts);
      slot.owners++;
    }
  }
  opaque(table: string, seq: number): IndexedFact | undefined {
    const id = this.missing.get(`${table}\0${seq}`)?.values().next().value; return id === undefined ? undefined : this.records.get(id);
  }
  *matching(condition: ExtentCondition, seq?: number): Generator<IndexedFact> {
    const slot = this.shared.indexes.get(`${condition.table}\0${condition.index}`); if (!slot) return;
    if (this.partitioned && seq === undefined) throw new TypeError('immutable fact seek requires an exact sequence');
    if (!slot.ready) {
      // @ref LLP 1018.008.007.002#6-reduce-the-remaining-preparation-and-publication-work — build only an observed integrity index, with both live and positive namespaces, before publishing it.
      const source = slot.index, built = new HeldIndex<Entry>(source.schema, source.table, source.name, source.parts, row => row.namespace);
      for (const member of this.shared.members) for (const record of member.records.values()) {
        const parts = record.table === condition.table && record.keys?.[condition.index];
        if (parts) built.putPrepared(member.postingId(record.id), record, parts);
      }
      slot.index = built; slot.ready = true;
    }
    const index = slot.index;
    for (const row of index.scan({ prefix: condition.prefix, order: condition.order,
      after: condition.after ? { Array: condition.after } : null, before: condition.before ? { Array: condition.before } : null,
      first: condition.first, last: condition.last,
      range: { gt: condition.gt?.[0] ?? null, gte: condition.gte?.[0] ?? null, lt: condition.lt?.[0] ?? null, lte: condition.lte?.[0] ?? null },
    },this.partitioned ? seq : -1)) yield row;
  }
}
