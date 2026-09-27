import type { Read } from "./contract.ts";
import { answerIdentity, answerObservation, revalidatingAnswer, type ReadObservation } from "./read-observation.ts";
import { holdReadExpiry } from "./read-expiry.ts";
import { ReadEpisode } from "./read-episode.ts";

export interface ApprovedAnswer {
  snapshot: Read<unknown>;
  read(): Read<unknown>;
  listeners: Set<() => void>;
}

// @ref LLP 3000.023#3.6 — one shared approval per raw watch, with A's own row and episode deadlines.
export class ReadApprovals {
  private readonly answers = new WeakMap<ReadObservation<unknown>, ApprovedAnswer>();
  private readonly releases = new Set<() => void>();
  private readonly drops = new WeakMap<ReadObservation<unknown>, (read: Read<unknown>) => () => void>();

  peek(read: Read<unknown>): Read<unknown> | undefined {
    const owner = answerObservation(read);
    return owner && this.drops.has(owner) ? this.answers.get(owner)?.read() : undefined;
  }
  get(read: Read<unknown>): ApprovedAnswer | undefined {
    const owner = answerObservation(read);
    if (!owner) return undefined;
    let answer = this.answers.get(owner);
    if (!answer) {
      // Notification ownership starts before authority, and survives releasing
      // the approved answer's expiry/follower registrations.
      const slot: ApprovedAnswer = { snapshot: "data" in read ? { loading: true } : read,
        read: () => slot.snapshot, listeners: new Set() };
      this.answers.set(owner, answer = slot);
    }
    return answer;
  }

  approve(read: Read<unknown>): ApprovedAnswer | undefined {
    const owner = answerObservation(read);
    if (!owner || !("data" in read)) return undefined;
    const answer = this.get(read)!;
    if (answerIdentity(answer.snapshot) === answerIdentity(read)) {
      // A source revalidation copy already updated the shared episode by value.
      return answer;
    }
    // Swap registrations without an intermediate loading notification.
    this.drops.get(owner)?.({ loading: true });
    answer.snapshot = read;
    const held = answer;
    const notify = () => { for (const listener of held.listeners) listener(); };
    const withdraw = () => {
      held.snapshot = { loading: true };
      episode.clear();
      return notify;
    };
    const episode = new ReadEpisode(() => { withdraw()(); });
    const expiry = holdReadExpiry(owner, withdraw);
    const update = (next: Read<unknown>) => {
      const changed = held.snapshot !== next;
      held.snapshot = next; episode.arm(next);
      return changed ? notify : undefined;
    };
    update(read);
    held.read = () => { expiry.check(); episode.check(); return held.snapshot; };
    const follow: Parameters<typeof owner.followers.add>[0] = change => {
      const next = owner.snapshot;
      if (change === "reset" || !("data" in next)) {
        return drop("data" in next ? { loading: true } : next);
      }
      // Opening remounts listen here before they subscribe to the raw source.
      if (!owner.retain && answerIdentity(next) !== answerIdentity(held.snapshot)) {
        return drop({ loading: true });
      }
      return update(answerIdentity(next) === answerIdentity(held.snapshot) ? next
        : revalidatingAnswer(held.snapshot, !owner.linger));
    };
    const release = () => {
      expiry.release(); episode.clear();
      owner.followers.delete(follow);
      this.releases.delete(release);
      this.drops.delete(owner);
      // Keep one empty slot so opening remounts follow the next approval too.
      held.snapshot = { loading: true };
      held.read = () => held.snapshot;
    };
    const drop = (read: Read<unknown>) => { release(); held.snapshot = read; return notify; };
    this.answers.set(owner, held);
    this.drops.set(owner, drop);
    this.releases.add(release);
    owner.followers.add(follow);
    return held;
  }

  reject(read: Read<unknown>, denied: Read<unknown>): void {
    const owner = answerObservation(read);
    if (!owner) return;
    const drop = this.drops.get(owner);
    if (drop) { drop(denied)(); return; }
    const answer = this.get(read)!;
    if (answer.snapshot === denied) return;
    answer.snapshot = denied;
    for (const listener of answer.listeners) listener();
  }
  close(): void {
    for (const release of this.releases) release();
  }
}
