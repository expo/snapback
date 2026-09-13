// The simulator witness's scenario, run inside the app: sync the partition
// into SQLite, read locally, send, reopen the store and find it all there.
// The report goes to witness/expo.mjs, which is waiting for it.
import { isReady } from "snapback4/contract";
import { api } from "../../chat/snapback/generated/api";
import { openClient, tier } from "./client";

async function until<T>(check: () => Promise<T | null>, ms = 20_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function runWitness(reportUrl: string): Promise<void> {
  const report: Record<string, unknown> = { platform: "ios-simulator", tier };
  // Each step is posted as it happens, so a stall names its step.
  const step = (name: string) => { console.log(`witness ${name}`); return fetch(`${reportUrl}/step`, { method: "POST", headers: { "content-type": "text/plain" }, body: `${tier}: ${name}` }).catch(() => undefined); };
  try {
    await step("start");
    const t0 = Date.now();
    const client = await openClient({ persona: "bob", guest: false });
    await step("opened");
    const syncMs = Date.now() - t0;
    const thread = await client.query(api.thread, { conversationId: "c1" });
    await step("thread read");
    const inbox = await client.query(api.inbox, {});
    const write = await client.mutate(api.send, { conversationId: "c1", body: "sent from the simulator" });
    await step(`sent: ${write.state}`);
    const after = await client.query(api.thread, { conversationId: "c1" });
    await client.close();
    await step("first done");
    report.first = {
      syncMs,
      threadRows: isReady(thread) ? thread.data.length : -1,
      threadComplete: isReady(thread) && thread.complete,
      next: isReady(thread) && !!thread.next,
      count: isReady(inbox) ? inbox.data[0]?.count : -1,
      write: write.state,
      // `last 50` reads newest first: the send is the first row, read
      // straight after `sent`; it stays `pending` until the stream's copy
      // replaces it, so that flag is a race, recorded not judged.
      sentRowRead: isReady(after) && after.data[0]?.body === "sent from the simulator",
      sentRowPending: isReady(after) ? after.data[0]?.pending === true : null,
    };
    // A second open on the same SQLite file: the rows are already there.
    const t1 = Date.now();
    const again = await openClient({ persona: "bob", guest: false });
    const reopenMs = Date.now() - t1;
    // The rows are there: the module answers through the count it maintains.
    const again_inbox = await again.query(api.inbox, {});
    const rows = isReady(again_inbox) ? Number(again_inbox.data[0]?.count ?? -1) : -1;
    const again_thread = await again.query(api.thread, { conversationId: "c1" });
    await again.close();
    report.second = { reopenMs, reopenedRows: rows, threadRows: isReady(again_thread) ? again_thread.data.length : -1 };
    await step("second done");
    // Native proof of the M6/M8 behaviours, on the real SQLite store: the
    // link is a fetch this app gates, so the server never has to die.
    // (a) A cold start with the server unreachable opens on what the
    // store holds and answers from it.
    let offline = true;
    const gated: typeof fetch = (input, init) => (offline ? Promise.reject(new TypeError("offline")) : fetch(input, init));
    const t2 = Date.now();
    const cold = await openClient({ persona: "bob", guest: false, fetch: gated });
    const coldMs = Date.now() - t2;
    const coldThread = await cold.query(api.thread, { conversationId: "c1" });
    // (b) A write composed offline is queued durably: it survives a restart
    // of the app still offline, and flushes in order on reconnect.
    const queued = await cold.mutate(api.send, { conversationId: "c1", body: "composed offline" });
    const queuedSecond = await cold.mutate(api.send, { conversationId: "c1", body: "composed offline, second" });
    await cold.close();
    const restarted = await openClient({ persona: "bob", guest: false, fetch: gated });
    const stillPending = await restarted.query(api.thread, { conversationId: "c1" });
    const pendingRows = isReady(stillPending) ? stillPending.data.filter((m) => m.pending === true).map((m) => m.body) : [];
    offline = false;
    const landedOrder = await until(async () => {
      const r = await restarted.query(api.thread, { conversationId: "c1" });
      if (!isReady(r)) return null;
      const mine = r.data.filter((m) => typeof m.body === "string" && m.body.startsWith("composed offline") && !m.pending);
      return mine.length === 2 ? mine.map((m) => m.body).reverse() : null;
    });
    await restarted.close();
    report.native = {
      coldMs,
      coldLink: cold.link(),
      coldThreadRows: isReady(coldThread) ? coldThread.data.length : -1,
      coldFresh: isReady(coldThread) ? coldThread.fresh : null,
      queued: queued.state,
      queuedSecond: queuedSecond.state,
      pendingAfterRestart: pendingRows,
      landedOrder,
    };
  } catch (error) {
    report.error = String((error as Error).message ?? error);
    await step(`error: ${report.error}`);
  }
  await fetch(reportUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
}
