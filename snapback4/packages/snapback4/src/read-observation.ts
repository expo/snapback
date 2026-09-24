import type { Read, Refusal } from "./contract.ts";

/** An unavailable rerun cannot retract an answer within this observation's
 * authority lifetime. Refusals and explicit lifetime resets can. */
export class ReadObservation<T> {
  snapshot: Read<T> = { loading: true };
  kept = false;
  private since: number | undefined;
  private transportRefusal = false;

  read(denied: Refusal | null): Read<T> {
    if (denied && (!("denied" in this.snapshot) || this.snapshot.denied.code !== denied.code)) this.reset({ denied });
    return this.snapshot;
  }

  publish(read: Read<T>, transportRefusal = false): void {
    if ("loading" in read && "denied" in this.snapshot && !this.transportRefusal) return;
    if ("loading" in read && "data" in this.snapshot) {
      this.snapshot = { ...this.snapshot, fresh: false, ...(this.since === undefined ? {} : { since: this.since }) };
      this.kept = true;
    } else {
      this.snapshot = read;
      this.kept = false;
      this.transportRefusal = "denied" in read && transportRefusal;
      this.since = "data" in read ? read.since ?? (read.fresh ? Date.now() : undefined) : undefined;
    }
  }

  reset(read: Read<T>): void {
    this.snapshot = read;
    this.kept = false;
    this.since = undefined;
    this.transportRefusal = false;
  }
}
