import { readKey, type ReadObservation } from "./read-observation.ts";

export type IndexedRead = ReadObservation<unknown> & {
  op: { name: string }; args: unknown; tables: Set<string>; subscribers: Set<() => void>;
  serverSeq?: number | undefined; validThrough?: number | undefined;
};
// @ref LLP 3000.029#8 — keys share replacements; tables delimit authority.
export class ReadIndex<W extends IndexedRead> extends Map<string, W> {
  private readonly byKey = new Map<string, Set<W>>();
  private readonly dependencies = new Map<string, Set<W>>();
  private readonly registered = new Map<W, { key: string; tables: Set<string> }>();
  private readonly cuts = new Map<string, number>();
  private receiptThrough: number | undefined;
  private add(index: Map<string, Set<W>>, key: string, watch: W): void {
    let group = index.get(key); if (!group) index.set(key, group = new Set()); group.add(watch);
  }
  private remove(index: Map<string, Set<W>>, key: string, watch: W): void {
    const group = index.get(key); group?.delete(watch); if (!group?.size) index.delete(key);
  }
  override set(key: string, watch: W): this {
    if (this.get(key) === watch) return this;
    this.delete(key);
    const canonical = readKey(watch.op, watch.args);
    let tables = watch.tables;
    const update = (next: Set<string>) => {
      const registration = this.registered.get(watch);
      if (registration) {
        for (const table of registration.tables) this.remove(this.dependencies, table, watch);
        registration.tables = new Set(next.size ? next : ["*"]);
        for (const table of registration.tables) this.add(this.dependencies, table, watch);
      }
      tables = next;
    };
    Object.defineProperty(watch, "tables", { configurable: true, enumerable: true, get: () => tables, set: update });
    // An adjacent receipt validates unrelated owners without visiting each one.
    // New bodies still pass the client's minimumReadSeq before publication.
    let validThrough = watch.validThrough;
    Object.defineProperty(watch, "validThrough", { configurable: true, enumerable: true,
      get: () => this.receiptThrough === undefined ? validThrough : Math.max(validThrough ?? 0, this.receiptThrough),
      set: (cut: number | undefined) => { validThrough = cut; },
    });
    this.registered.set(watch, { key: canonical, tables: new Set() });
    this.add(this.byKey, canonical, watch); update(tables);
    return super.set(key, watch);
  }
  override delete(key: string): boolean {
    const watch = this.get(key), registration = watch && this.registered.get(watch);
    if (watch && registration) {
      this.remove(this.byKey, registration.key, watch);
      for (const table of registration.tables) this.remove(this.dependencies, table, watch);
      this.registered.delete(watch);
    }
    return super.delete(key);
  }
  override clear(): void { for (const key of this.keys()) this.delete(key); this.clearAuthority(); }
  matching(op: { name: string }, args: unknown): Iterable<W> { return this.byKey.get(readKey(op, args)) ?? []; }
  affected(tables?: Iterable<string>): Set<W> {
    if (!tables) return new Set(this.values());
    const result = new Set(this.dependencies.get("*"));
    for (const table of tables) for (const watch of this.dependencies.get(table) ?? []) result.add(watch);
    return result;
  }
  minimum(tables: Set<string>): number {
    let cut = this.cuts.get("*") ?? 0;
    for (const table of tables.size ? tables : this.cuts.keys()) cut = Math.max(cut, this.cuts.get(table) ?? 0);
    return cut;
  }
  evidence(tables: Set<string>, cut?: number, dependencyFree = false): Set<W> {
    // An explicit empty server footprint certifies no data dependencies. Missing inputs remain unknown.
    if (dependencyFree) return new Set();
    if (cut === undefined) return this.affected(tables.size ? tables : undefined);
    const advanced: string[] = [];
    for (const table of tables.size ? tables : ["*"]) if (cut > (this.cuts.get(table) ?? -1)) {
      this.cuts.set(table, cut); advanced.push(table);
    }
    return advanced.length ? this.affected(advanced.includes("*") ? undefined : advanced) : new Set();
  }
  // @ref LLP 3000.029#9 — only contiguous known receipts use affected buckets;
  // an unseen gap or unknown footprint still inspects every owner's interval.
  receiptCandidates(cut: number, head: number, inputs?: readonly string[]): { affected: Set<W>; candidates: Iterable<W> } {
    if (this.receiptThrough !== undefined && head <= this.receiptThrough && cut <= this.receiptThrough) return { affected: new Set(), candidates: [] };
    const affected = this.affected(inputs);
    const adjacent = inputs !== undefined && this.receiptThrough !== undefined && cut === this.receiptThrough + 1 && head === cut;
    return { affected, candidates: adjacent ? affected : this.values() };
  }
  coverReceipt(cut: number): void { this.receiptThrough = Math.max(this.receiptThrough ?? 0, cut); }
  clearReceipts(): void { this.receiptThrough = undefined; }
  clearAuthority(): void { this.cuts.clear(); this.clearReceipts(); }
}
