#!/usr/bin/env node
// The Chromium witness (LLP 2000.000 §11.5): what the simulator cannot
// reach — IndexedDB. A real page on the local-first client against a real
// `snapback4 dev`: the wasm device syncs and keeps its partition in
// IndexedDB behind each call, reads run on it, a queued write survives a
// reload, and the rows kept are what the server sent. Prints one JSON line.
import { launch, record } from "./lib.mjs";

const witness = await launch({ seed: [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
  { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
  ...Array.from({ length: 300 }, (_, n) => ({ table: "messages", row: { id: `seed${String(n).padStart(4, "0")}`, conversationId: "c1", authorId: n % 2 ? "dev:alice" : "dev:bob", body: `seed ${n}`, at: 1_700_000_000_000 + n, editedAt: null, photo: null } })),
] });
const { page, api } = witness;
const out = { chromium: witness.chromium, pageErrors: [] };
// Nothing the client does may surface as an unhandled error in the page:
// a refused prediction is `failed` on the card, not a pageerror.
page.on("pageerror", (error) => out.pageErrors.push(String(error.message ?? error)));
try {
  // First session: sync into IndexedDB, read locally, send while offline (a
  // blocked fetch), then leave the page with the write queued.
  const first = await page.evaluate(async (api) => {
    const t0 = performance.now();
    // The client's fetch is looked up per call, so the page can cut the link.
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const synced = performance.now() - t0;
    const thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    const inbox = await client.query({ kind: "query", name: "inbox" }, {});
    // A refused prediction (a stranger's send) is `failed`, typed, with no page error.
    const stranger = await window.createLocalClient({ url: api, persona: "mallory", waitSeconds: 1, fetch: (...args) => window.fetch(...args) });
    const refused = await stranger.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "not a member" });
    await stranger.close();
    // Go offline: every fetch fails from here.
    const realFetch = window.fetch;
    window.fetch = () => Promise.reject(new TypeError("offline"));
    const write = await client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "queued while offline" });
    const local = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
    window.fetch = realFetch;
    await client.close();
    return { syncMs: +synced.toFixed(1), threadRows: thread.data.length, threadComplete: thread.complete, next: !!thread.next, count: inbox.data[0].count, write: write.state, pendingLocally: local.data[0].pending === true, localFresh: local.fresh, refused: refused.state === "failed" ? refused.why?.code : refused.state };
  }, api);
  Object.assign(out, { first });
  // Second session: a fresh page on the same origin opens the same
  // IndexedDB; the partition is already there and the queued write lands.
  await witness.reload();
  const second = await page.evaluate(async (api) => {
    const rows = await new Promise((resolve, reject) => {
      const open = indexedDB.open(`snapback4-${encodeURIComponent(`${api}:dev:bob`)}`, 1);
      open.onsuccess = () => { const tx = open.result.transaction("changes"); const req = tx.objectStore("changes").count(IDBKeyRange.bound(["r", ""], ["r", "\uffff"])); req.onsuccess = () => { resolve(req.result); open.result.close(); }; req.onerror = () => reject(req.error); };
      open.onerror = () => reject(open.error);
    });
    const t0 = performance.now();
    const client = await window.createLocalClient({ url: api, persona: "bob", waitSeconds: 1 });
    const reopened = performance.now() - t0;
    let thread;
    for (let i = 0; i < 100; i++) {
      thread = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1" });
      if (thread.data[0]?.body === "queued while offline" && !thread.data[0].pending) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await client.close();
    return { rowsInIdbBeforeOpen: rows, reopenMs: +reopened.toFixed(1), landed: thread.data[0]?.body === "queued while offline" && !thread.data[0].pending };
  }, api);
  Object.assign(out, { second });
  out.ok = first.threadRows === 50 && first.threadComplete && first.next && first.count === 300 && first.write === "pending" && first.pendingLocally && !first.localFresh && first.refused === "NOT_MEMBER" && second.rowsInIdbBeforeOpen > 300 && second.landed && out.pageErrors.length === 0;
} finally {
  await witness.close();
}
console.log(JSON.stringify({ witness: "chromium-indexeddb", ...out }));
process.exit(out.ok ? 0 : 1);
