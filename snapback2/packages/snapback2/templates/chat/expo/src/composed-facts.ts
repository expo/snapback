import { api, type SnapbackClient } from "snapback2/client";
import { conversationItems } from "../shared/thread";

export async function composedFacts(client: SnapbackClient, conversationId: string, timeoutMs = 5_000) {
  const observed = client.observe(api.messages.conversationView, { conversationId }, { items: conversationItems });
  const stop = observed.subscribe(() => undefined);
  try {
    const settled = () => {
      const snapshot = observed.getSnapshot();
      return snapshot.status !== "loading" && (snapshot.history === undefined || snapshot.history.status !== "loading");
    };
    const deadline = Date.now() + timeoutMs;
    while (!settled() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const snapshot = observed.getSnapshot();
    return { itemsFrom: snapshot.itemsFrom, status: snapshot.status, outcome: snapshot.receipt?.outcome ?? null,
      history: snapshot.history ? { status: snapshot.history.status, outcome: snapshot.history.receipt?.outcome ?? null } : null,
      keys: snapshot.items.map((item) => item.key), timedOut: !settled() };
  } finally { stop(); }
}
