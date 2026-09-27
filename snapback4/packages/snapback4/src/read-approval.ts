import type { Read } from "./contract.ts";
import { answerIdentity, answerObservation, staleAnswer, type ReadObservation } from "./read-observation.ts";
import { holdReadExpiry } from "./read-expiry.ts";

export interface ApprovedAnswer {
  snapshot: Read<unknown>;
  read(): Read<unknown>;
  listeners: Set<() => void>;
}

// @ref LLP 3000.019#3.3 — retain one approved answer per facade and live raw watch, including its linger.
// There is no independent keep window: raw reset/close releases the answer and timer.
export class ReadApprovals {
  private readonly answers = new WeakMap<ReadObservation<unknown>, ApprovedAnswer>();
  private readonly releases = new Set<() => void>();

  peek(read: Read<unknown>): Read<unknown> | undefined {
    return this.get(read)?.read();
  }

  get(read: Read<unknown>): ApprovedAnswer | undefined {
    const owner = answerObservation(read);
    return owner ? this.answers.get(owner) : undefined;
  }

  approve(read: Read<unknown>): ApprovedAnswer | undefined {
    const owner = answerObservation(read);
    if (!owner || !("data" in read)) return undefined;
    let answer = this.answers.get(owner);
    // Reusing an already approved identity must not adopt a replacement's deadline.
    if (answer && answerIdentity(answer.snapshot) === answerIdentity(read)) {
      answer.snapshot = read;
      return answer;
    }
    // Each slot owns exactly one timer and one source follower.
    this.drop(owner);
    answer ??= { snapshot: read, read: () => read, listeners: new Set() };
    answer.snapshot = read;
    const held = answer, since = owner.since;
    const notify = () => { for (const listener of held.listeners) listener(); };
    const expiry = holdReadExpiry(owner, () => {
      held.snapshot = { loading: true };
      return notify;
    });
    held.read = () => { expiry.check(); return held.snapshot; };
    const follow: Parameters<typeof owner.followers.add>[0] = change => {
      if (change === "expiry") return; // Our own deadline participates in the same sweep.
      const next = owner.snapshot;
      if (change === "reset" || "denied" in next) {
        held.snapshot = "data" in next ? { loading: true } : next;
        release();
        return notify;
      } else if ("data" in next) {
        held.snapshot = answerIdentity(next) === answerIdentity(held.snapshot)
          ? next : staleAnswer(held.snapshot, since);
      }
    };
    const release = () => {
      expiry.release();
      owner.followers.delete(follow);
      this.releases.delete(release);
      this.answers.delete(owner);
      this.drops.delete(owner);
    };
    this.answers.set(owner, held);
    this.drops.set(owner, (read = { loading: true }) => { held.snapshot = read; release(); });
    this.releases.add(release);
    owner.followers.add(follow);
    return held;
  }

  reject(read: Read<unknown>, denied: Read<unknown>): void {
    const owner = answerObservation(read);
    if (owner) this.drops.get(owner)?.(denied);
  }

  private readonly drops = new WeakMap<ReadObservation<unknown>, (read?: Read<unknown>) => void>();
  private drop(owner: ReadObservation<unknown>): void { this.drops.get(owner)?.(); }

  close(): void {
    for (const release of this.releases) release();
  }
}
