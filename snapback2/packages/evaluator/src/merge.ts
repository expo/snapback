import { field, totalCompare, asString } from "./value-runtime";
import type { Value } from "./types";

// @ref LLP 1010#a5-the-merged-feed — the twin advances precisely the winning stream, including two lookahead rows.
export function mergeStreams(
  next: Array<() => Value | null>, suffix: string[], order: "Asc" | "Desc", take: number,
  step: () => void, emit: (lane: number, row: Value) => void,
): { rows: Value[]; union: number } {
  type Head = { lane: number; row: Value; key: Value };
  const heap: Head[] = [];
  const before = (a: Head, b: Head): boolean => {
    step();
    return totalCompare(a.key, b.key) * (order === "Asc" ? 1 : -1) < 0;
  };
  const push = (lane: number): void => {
    const row = next[lane]!();
    if (row === null) return;
    heap.push({ lane, row, key: { Array: suffix.map((column) => field(row, column)) } });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (!before(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!]; i = parent;
    }
  };
  next.forEach((_, lane) => push(lane));
  const seen = new Set<string>();
  const rows: Value[] = [];
  while (heap.length && seen.size < take + 2) {
    const head = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) heap[0] = last;
    let i = 0;
    while (2 * i + 1 < heap.length) {
      let child = 2 * i + 1;
      if (child + 1 < heap.length && before(heap[child + 1]!, heap[child]!)) child++;
      if (!before(heap[child]!, heap[i]!)) break;
      [heap[i], heap[child]] = [heap[child]!, heap[i]!]; i = child;
    }
    step();
    const id = asString(field(head.row, "id"));
    if (!seen.has(id)) {
      seen.add(id);
      if (rows.length < take) { rows.push(head.row); emit(head.lane, head.row); }
    }
    push(head.lane);
  }
  return { rows, union: seen.size };
}
