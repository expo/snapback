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

/** Remembered server answers, which a later recovery may show. Every read takes
 * a ticket as it begins, and a write of a key applies only if no read that began
 * later has written that key: an older reply never replaces a newer one, nor a
 * newer deletion (LLP 3000.017 §3.2). */
export class RememberedAnswers {
  private readonly answers = new Map<string, ServerAnswer>();
  private readonly written = new Map<string, number>();
  private tickets = 0;
  /** The ticket of a read that is about to begin. */
  begin(): number { return ++this.tickets; }
  get(key: string): ServerAnswer | undefined { return this.answers.get(key); }
  set(key: string, answer: ServerAnswer, ticket: number): void {
    if ((this.written.get(key) ?? 0) > ticket) return;
    this.answers.set(key, answer); this.written.set(key, ticket);
  }
  delete(key: string, ticket: number): void {
    if ((this.written.get(key) ?? 0) > ticket) return;
    this.answers.delete(key); this.written.set(key, ticket);
  }
  clear(): void { this.answers.clear(); this.written.clear(); }
  /** The cache as one read writes it, under that read's ticket. */
  view(ticket = this.begin()) {
    return { get: (key: string) => this.get(key), set: (key: string, answer: ServerAnswer) => this.set(key, answer, ticket), delete: (key: string) => this.delete(key, ticket) };
  }
}

/** Every local commit retires retained answers. */
export class LocalReads {
  revision = 0;
  readonly serverAnswers = new RememberedAnswers();

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
