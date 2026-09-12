// The simulator witness's scenario, run inside the app: sync the partition
// into SQLite, read locally, send, reopen the store and find it all there.
// The report goes to witness/expo.mjs, which is waiting for it.
import { isReady } from "snapback4/contract";
import { api } from "../../chat/snapback/generated/api";
import { openClient } from "./client";

export async function runWitness(reportUrl: string): Promise<void> {
  const report: Record<string, unknown> = { platform: "ios-simulator" };
  try {
    const t0 = Date.now();
    const client = await openClient({ persona: "bob", guest: false });
    const syncMs = Date.now() - t0;
    const thread = await client.query(api.thread, { conversationId: "c1" });
    const inbox = await client.query(api.inbox, {});
    const write = await client.mutate(api.send, { conversationId: "c1", body: "sent from the simulator" });
    const after = await client.query(api.thread, { conversationId: "c1" });
    const state = await client.replica.state();
    await client.close();
    report.first = {
      syncMs,
      threadRows: isReady(thread) ? thread.data.length : -1,
      threadComplete: isReady(thread) && thread.complete,
      next: isReady(thread) && !!thread.next,
      count: isReady(inbox) ? inbox.data[0]?.count : -1,
      write: write.state,
      landed: isReady(after) && after.data[0]?.body === "sent from the simulator" && !after.data[0]?.pending,
      watermark: state.watermark,
    };
    // A second open on the same SQLite file: the rows are already there.
    const t1 = Date.now();
    const again = await openClient({ persona: "bob", guest: false });
    const reopenMs = Date.now() - t1;
    const rows = await again.replica.store.read((tx) => tx.count("messages", "byConvTime", ["c1"], 10_000));
    const again_thread = await again.query(api.thread, { conversationId: "c1" });
    await again.close();
    report.second = { reopenMs, reopenedRows: rows, threadRows: isReady(again_thread) ? again_thread.data.length : -1 };
  } catch (error) {
    report.error = String((error as Error).message ?? error);
  }
  await fetch(reportUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
}
