import type { Query } from "./contract.ts";
import { ReadObservation } from "./read-observation.ts";
import type { BackendJson } from "./backend.ts";

export function runsOnServer(backend: BackendJson, op: Query<unknown, unknown>, nativeReady: boolean): boolean {
  const program = backend.programs.find(program => program.name === op.name);
  if (program?.native) return !nativeReady;
  return (backend.schema.operations?.[op.name]?.runs ?? program?.runs ?? op.runs) === "server";
}

export function predictedTables(predicted: readonly string[]): Set<string> {
  // Footprints are table/id; ids may themselves contain slashes.
  return new Set(predicted.map(row => row.slice(0, row.indexOf("/"))).filter(Boolean));
}

export interface LocalWatch extends ReadObservation<unknown> {
  op: Query<unknown, unknown>;
  args: unknown;
  key: string;
  tables: Set<string>;
  /** Re-runs a watch whose server answer read presence (LLP 3000.017), every
   * `presenceEvery` ms from then on. */
  presenceRefresh: ReturnType<typeof setTimeout> | null;
  presenceEvery?: number | undefined;
  subscribers: Set<() => void>;
  running: boolean;
  dirty: boolean;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  incarnation: number;
}

export type ServerAnswer = {
  read: Extract<import("./contract.ts").Read<unknown>, { data: unknown }>;
  at: number;
  nextExpiry: number | null;
  tables: Set<string>;
};

/** The answer cache a background presence read writes through. Its writes wait
 * until the read is accepted, and then touch only entries that no other read
 * replaced meanwhile (LLP 3000.017 §3.2). */
export function stagedAnswers(target: Map<string, ServerAnswer>) {
  const initial = new Map(target);
  const writes = new Map<string, ServerAnswer | null>();
  return {
    get: (key: string) => writes.has(key) ? writes.get(key) ?? undefined : target.get(key),
    set: (key: string, answer: ServerAnswer) => { writes.set(key, answer); },
    delete: (key: string) => { writes.set(key, null); },
    commit() {
      for (const [key, answer] of writes) {
        if (target.get(key) !== initial.get(key)) continue; // Another read replaced it since this one began.
        if (answer) target.set(key, answer); else target.delete(key);
      }
    },
  };
}

/** Every local commit retires retained answers. */
export class LocalReads {
  revision = 0;
  readonly serverAnswers = new Map<string, ServerAnswer>();

  clear(watches: Iterable<LocalWatch>): void {
    this.revision++;
    this.serverAnswers.clear();
    for (const watch of watches) {
      watch.reset({ loading: true });
      if (watch.expiryTimer) clearTimeout(watch.expiryTimer);
      watch.expiryTimer = null;
      // A replaced store relearns presence intervals from its next server answer.
      if (watch.presenceRefresh) clearTimeout(watch.presenceRefresh);
      watch.presenceRefresh = null;
      watch.presenceEvery = undefined;
    }
  }
}
