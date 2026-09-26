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

/** Where a server's answer or refusal stands: the store cut the server read,
 * then when the read began. */
export type AnswerOrder = { seq: number; ticket: number };

/** Remembered server answers, which a later recovery may show. A server's
 * answer, or its refusal, replaces what is remembered for its key only if it
 * is not older: a later store cut wins, and at the same cut the read that
 * began later wins (LLP 3000.017 §3.2). */
export class RememberedAnswers {
  private readonly answers = new Map<string, ServerAnswer>();
  private readonly written = new Map<string, AnswerOrder>();
  private tickets = 0;
  /** The ticket of a read attempt that is about to begin. */
  begin(): number { return ++this.tickets; }
  get(key: string): ServerAnswer | undefined { return this.answers.get(key); }
  set(key: string, answer: ServerAnswer, order: AnswerOrder): void {
    if (!this.current(key, order)) return;
    this.answers.set(key, answer); this.written.set(key, order);
  }
  /** A server's refusal or loading answer: nothing is remembered for the key. */
  delete(key: string, order: AnswerOrder): void {
    if (!this.current(key, order)) return;
    this.answers.delete(key); this.written.set(key, order);
  }
  /** Local cleanup, of an expired answer or a composed query's: the order stands. */
  forget(key: string): void { this.answers.delete(key); }
  clear(): void { this.answers.clear(); this.written.clear(); }
  /** The cache as one read attempt writes it: the server's cut, then the attempt's ticket. */
  view(ticket = this.begin()) {
    return {
      get: (key: string) => this.get(key),
      set: (key: string, answer: ServerAnswer, seq: number) => this.set(key, answer, { seq, ticket }),
      delete: (key: string, seq: number) => this.delete(key, { seq, ticket }),
      forget: (key: string) => this.forget(key),
    };
  }
  private current(key: string, order: AnswerOrder): boolean {
    const slot = this.written.get(key);
    return !slot || order.seq > slot.seq || (order.seq === slot.seq && order.ticket >= slot.ticket);
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
