import type { Read } from "./contract.ts";

// @ref LLP 3000.023#3.1 — one absolute host deadline, copied by value with the displayed answer.
const deadlines = new WeakMap<Read<unknown>, number>();
export const episodeDeadline = (read: Read<unknown>): number | undefined => deadlines.get(read);
export function copyEpisode(from: Read<unknown>, to: Read<unknown>): void {
  const deadline = episodeDeadline(from);
  if (deadline !== undefined) deadlines.set(to, deadline);
}
export function beginEpisode(from: Read<unknown>, to: Read<unknown>, bounded: boolean): void {
  copyEpisode(from, to);
  if (bounded && episodeDeadline(to) === undefined) deadlines.set(to, Date.now() + 1000);
}

/** A deadline check and timer share one latch. Withdrawal does not fence the read in flight. */
export class ReadEpisode {
  private deadline: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private withdraw: () => void) {}
  arm(read: Read<unknown>): void {
    const deadline = episodeDeadline(read);
    if (deadline === this.deadline && (deadline === undefined || this.timer !== undefined)) return;
    this.clear();
    this.deadline = deadline;
    if (deadline !== undefined) this.schedule();
  }
  check(): void {
    if (this.deadline !== undefined && Date.now() >= this.deadline) {
      this.clear();
      this.withdraw();
    }
  }
  clear(): void {
    this.stop();
    this.deadline = undefined;
  }
  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.check();
      if (this.deadline !== undefined) this.schedule();
    }, Math.min(2_147_483_647, Math.max(0, this.deadline! - Date.now())));
    (this.timer as { unref?: () => void }).unref?.();
  }
}
