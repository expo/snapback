import type { Snapshot } from "snapback2/client";

type View = Pick<Snapshot<unknown>, "receipt" | "status">;
export function threadWitness(snapshot: View & Pick<Snapshot<unknown>, "partial" | "reason"> & { history?: View }) {
  const history = snapshot.partial || snapshot.reason?.code === "partial";
  const visible = history ? snapshot.history ?? snapshot : snapshot;
  const state = visible.receipt?.state ?? visible.status;
  return {
    summary: { "data-view-state": snapshot.receipt?.state ?? snapshot.status, "data-view-seq": snapshot.receipt?.seq },
    historyNote: { "data-history-state": state },
    bubbles: { "data-view-state": state, "data-view-seq": visible.receipt?.seq,
      "data-view-source": history ? "partial-history" : "composite" },
  };
}
