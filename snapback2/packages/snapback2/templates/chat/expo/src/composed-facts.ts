import { api, type SnapbackClient } from "snapback2/client";
import { conversationItems } from "../shared/thread";

// @ref LLP 1018.006#5-surface — the composed observation the Thread screen
// renders, sampled for the witness once the composite and, while eligible,
// its history have both left `loading`; a sample that gave up says so.
export async function composedFacts(client: SnapbackClient, conversationId: string, timeoutMs = 5_000) {
  const observed = client.observe(api.deliveries.conversationView, { conversationId }, { items: conversationItems });
  const stop = observed.subscribe(() => undefined);
  try {
    const settled = () => {
      const snapshot = observed.getSnapshot();
      return snapshot.status !== "loading" && (snapshot.history === undefined || snapshot.history.status !== "loading");
    };
    const deadline = Date.now() + timeoutMs;
    while (!settled() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const snapshot = observed.getSnapshot();
    return { itemsFrom: snapshot.itemsFrom, status: snapshot.status, verdict: snapshot.receipt?.state ?? null,
      history: snapshot.history ? { status: snapshot.history.status, verdict: snapshot.history.receipt?.state ?? null } : null,
      keys: snapshot.items.map((item) => item.key), timedOut: !settled() };
  } finally { stop(); }
}
