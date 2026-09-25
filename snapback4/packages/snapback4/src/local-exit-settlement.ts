import type { Refusal, Write } from "./contract.ts";
import type { PendingSend } from "./local-exit.ts";

type Failure = Extract<Write, { state: "failed" }>;

// @ref LLP 3000.013#6 — an ordinary request owns its outcome through close;
// a replacement's refusal cannot contradict that request's committed success.
export function exitRefusalSettlement(options: {
  closed(): boolean;
  owners: Set<string>;
  active: Set<Promise<unknown>>;
  commit(write: Failure): Promise<boolean>;
  publish(write: Failure): void;
}) {
  return async (entry: PendingSend, why: Refusal): Promise<void> => {
    if (options.closed() || options.owners.has(entry.id)) return;
    options.owners.add(entry.id);
    const work = (async () => {
      const write: Failure = { state: "failed", id: entry.id, why };
      // Recheck terminal history and outbox custody in the device's serialized
      // transaction. Publish only after receipt + retirement commit together.
      if (await options.commit(write)) options.publish(write);
    })();
    options.active.add(work);
    try { await work; }
    finally { options.owners.delete(entry.id); options.active.delete(work); }
  };
}
