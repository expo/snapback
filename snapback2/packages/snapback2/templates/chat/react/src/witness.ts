import type { Snapshot } from "snapback2/client";

type View = Pick<Snapshot<unknown>, "receipt" | "status">;
export function threadWitness(snapshot: View & { history?: View }) {
  const visible = snapshot.history ?? snapshot;
  const state = visible.receipt?.state ?? visible.status;
  return {
    summary: { "data-view-state": snapshot.receipt?.state ?? snapshot.status, "data-view-seq": snapshot.receipt?.seq },
    historyNote: { "data-history-state": state },
    bubbles: { "data-view-state": state, "data-view-seq": visible.receipt?.seq,
      "data-view-source": snapshot.history ? "partial-history" : "composite" },
  };
}
