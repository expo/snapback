import type { Change } from "./web.ts";

// @ref LLP 3000.007#20.4 — bounded wasm strings, one complete strict host save.
export function drainChanges(device: { drain(): string; drain_chunk?(): string }): Change[] {
  if (!device.drain_chunk) return JSON.parse(device.drain()) as Change[];
  const changes: Change[] = [];
  for (;;) {
    const chunk = JSON.parse(device.drain_chunk()) as Change[];
    if (!chunk.length) return changes;
    for (const change of chunk) changes.push(change);
  }
}
