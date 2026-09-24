import type { Refusal, Write } from "./contract.ts";

// @ref LLP 3000.013#6 — close's cutoff is completion of local cleanup, not its start.
// Network waits detach immediately. Bodies arriving during local cleanup still
// belong to their callers; later bodies are consumed without publication.
export class ClosingResponses {
  private capturing = false;
  private replies = new Map<string, Record<string, unknown>>();
  begin(): void { this.capturing = true; }
  finish(): void { this.capturing = false; }
  capture(path: string, body: unknown, json: Record<string, unknown>, status: number): void {
    if (!this.capturing || status >= 500 || !(path.startsWith("/m/") || path.startsWith("/a/"))) return;
    const id = (body as { id?: string }).id;
    if (id) this.replies.set(id, json);
  }
  take(id: string): { ok: true; json: Record<string, unknown> } | undefined {
    const json = this.replies.get(id);
    this.replies.delete(id);
    return json ? { ok: true, json } : undefined;
  }
  write<R>(pending: Write<R>): Write<R> {
    if (pending.state !== "pending") return pending;
    const json = this.take(pending.id)?.json;
    if (json?.state === "sent") return { state: "sent", id: pending.id, seq: Number(json.seq ?? 0),
      ...(json.replayed === true ? { replayed: true } : { result: json.result as R }) };
    const why = (json?.why ?? json?.denied) as Refusal | undefined;
    return why && !why.retryable ? { state: "failed", id: pending.id, why } : pending;
  }
}
