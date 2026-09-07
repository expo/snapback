// @ref LLP 1012#6-reads-offline — page extent endpoints maintain complete-prefix proof in logarithmic work.
import { Ordered } from './ordered';
import { compareArrays } from './value-runtime';
import type { Value } from './types';
export class CoverageSpans {
  private events: Ordered<Value[] | null, number, { sum: number; min: number }>;
  private ends: Ordered<Value[] | null, number>;
  private rows: Ordered<Value[] | null, number>;
  constructor(descending: boolean) {
    this.events = new Ordered((a, b) => a === null ? b === null ? 0 : -1 : b === null ? 1 : compareArrays(a, b) * (descending ? -1 : 1),
      (left, value, right) => { const sum = (left?.sum ?? 0) + value;
        return { sum: sum + (right?.sum ?? 0), min: Math.min(left?.min ?? Infinity, sum, sum + (right?.min ?? Infinity)) }; });
    this.ends = new Ordered(this.events.compare); this.rows = new Ordered(this.events.compare);
  }
  get complete(): boolean {
    const end = this.ends.seek(() => 0).next().value, row = this.rows.seek(() => 0, true).next().value;
    return (!end || !row || this.events.compare(end[0], row[0]) >= 0)
      && (this.events.get(null) ?? 0) > 0 && (this.events.summary?.min ?? 0) > 0;
  }
  change(start: Value[] | null, end: Value[] | null, delta: 1 | -1, last?: Value[] | null): void {
    if (start && end && this.events.compare(start, end) >= 0) return;
    this.event(start, delta); if (end) this.event(end, -delta);
    if (last !== undefined) {
      this.count(this.rows, last, delta);
      if (!end) this.count(this.ends, this.events.compare(start, last) > 0 ? start : last, delta);
    }
  }
  private count(tree: Ordered<Value[] | null, number>, key: Value[] | null, delta: number): void {
    const count = (tree.get(key) ?? 0) + delta;
    if (count) tree.set(key, count); else tree.delete(key);
  }
  private event(key: Value[] | null, delta: number): void {
    const value = (this.events.get(key) ?? 0) + delta;
    if (value) this.events.set(key, value); else this.events.delete(key);
  }
}
