import type { BackendJson } from "./backend.ts";
import type { LocalResult, Queued } from "./local-types.ts";
import { successSequence } from "./local-receipts.ts";
import { dependencies, intersects, waitForQueryWrites } from "./query-dependencies.ts";

type Candidate = Pick<LocalResult<unknown>, "served" | "localWakeup" | "custodyWaiting">;

// @ref LLP 3000.023#11 — this is a view of outbox custody, never a second outbox.
export class QueryCustody {
  private readonly operations = new Map<string, string>();
  constructor(private readonly backend: () => BackendJson | null,
    private readonly queued: () => Promise<Queued[]>,
    private readonly subscribe: (notify: () => void) => () => void,
    private readonly unavailable: () => unknown,
    private readonly acquire: () => Promise<unknown>,
    private readonly offline: () => boolean) {}
  private affects(query: string, operation: string): boolean {
    return intersects(dependencies(this.backend(), query)?.reads, dependencies(this.backend(), operation)?.writes);
  }
  async blocked(query: string, candidate: Candidate, acquire = false): Promise<boolean> {
    if (this.unavailable()) return false;
    // Narrow the old predicate: complete device predictions still settle.
    const writes = (await this.queued()).filter(w => w.observed_seq == null && (!w.predictable || candidate.served || candidate.localWakeup || candidate.custodyWaiting) && this.affects(query, w.op));
    if (acquire && writes.some(w => successSequence(w) != null)) void this.acquire().catch(() => {});
    return writes.length > 0;
  }
  wait(query: string, candidate: Candidate, signal: AbortSignal): Promise<void> {
    return waitForQueryWrites(() => !this.offline() && this.blocked(query, candidate, true), this.subscribe, signal);
  }
  admitted(id: string, operation: string): void { this.operations.set(id, operation); }
  recovered(entries: Queued[]): void {
    this.operations.clear(); // A stale snapshot can only widen a later commit to unknown.
    for (const entry of entries) if (entry.observed_seq == null) this.operations.set(entry.id, entry.op);
  }
  settled(id: string): void { this.operations.delete(id); }
  effects(id: string) {
    const operation = this.operations.get(id), writes = operation && dependencies(this.backend(), operation)?.writes;
    return writes || undefined;
  }
}
