import type { Refusal, Write } from "./contract.ts";

// @ref LLP 3000.013#6 — each invocation owns its reply through the public close cutoff.
// The private app wrapper can extend that cutoff through its session cleanup;
// raw close still waits only for its own local work, never for caller outcomes.
const owners = new WeakMap<object, ClosingResponses>();
export const trackClose = (client: object, responses: ClosingResponses): void => { owners.set(client, responses); };
export const inheritClose = (client: object, raw: object): void => {
  const responses = owners.get(raw); if (responses) owners.set(client, responses);
};
export const holdClose = (client?: object): (() => void) => client ? owners.get(client)?.hold() ?? (() => {}) : () => {};

export class ClosingResponses {
  private phase: "open" | "closing" | "complete" = "open";
  private finished = false;
  private holds = 0;
  private resolve!: () => void;
  readonly done = new Promise<void>(resolve => { this.resolve = resolve; });
  begin(): void { if (this.phase === "open") this.phase = "closing"; }
  hold(): () => void {
    if (this.phase === "complete") return () => {};
    this.holds++;
    let held = true;
    return () => { if (held) { held = false; this.holds--; this.complete(); } };
  }
  finish(): void { this.finished = true; this.complete(); }
  private complete(): void {
    if (this.finished && this.holds === 0 && this.phase !== "complete") { this.phase = "complete"; this.resolve(); }
  }
  // A body can become known while open, then cross close during receipt
  // application. The invocation retains it from dispatch through the cutoff.
  request(): ClosingResponse { return new ClosingResponse(() => this.phase !== "complete"); }
}

/** A request's identity is this object, never its mutation/action id. Retrying
 * the transport may reuse it; overlapping submissions cannot steal its body. */
export class ClosingResponse {
  private json?: Record<string, unknown>;
  // A decoded auth refusal can be superseded by rotation before settlement;
  // retaining its body does not grant it authority over a successor bearer.
  private applicable: () => boolean = () => true;
  constructor(private capturing: () => boolean) {}
  capture(json: Record<string, unknown>, status: number, applicable: () => boolean = () => true): void {
    if (this.capturing() && status < 500 && applicable()) { this.json = json; this.applicable = applicable; }
  }
  take(): { ok: true; json: Record<string, unknown> } | undefined {
    return this.json && this.applicable() ? { ok: true, json: this.json } : undefined;
  }
  write<R>(pending: Write<R>): Write<R> {
    if (pending.state !== "pending") return pending;
    const json = this.take()?.json;
    if (json?.state === "sent") return { state: "sent", id: pending.id, seq: Number(json.seq ?? 0),
      ...(json.replayed === true ? { replayed: true } : { result: json.result as R }) };
    const why = (json?.why ?? json?.denied) as Refusal | undefined;
    return why && !why.retryable ? { state: "failed", id: pending.id, why } : pending;
  }
}
