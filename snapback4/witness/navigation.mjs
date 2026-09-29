// Real navigation: committed IndexedDB outbox, cancelled ordinary transport,
// keepalive reaches the server before another page opens the device.
import assert from "node:assert/strict";
import { launch } from "./lib.mjs";

const witness = await launch({ seed: [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
] });
const { page, api } = witness;
const rows = async () => (await fetch(api + "/q/thread", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { conversationId: "c1" } }) }).then(r => r.json())).data;
try {
  const writes = await page.evaluate(async api => {
    let offline = false;
    const client = await window.createLocalClient({ url: api, persona: "alice", waitSeconds: 1,
      fetch: (url, init) => offline && !init?.keepalive ? Promise.reject(new TypeError("ordinary page transport stopped")) : fetch(url, init) });
    offline = true; await client.sync();
    const writes = await Promise.all(["exit one", "exit two"].map(body => client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body })));
    // Read the actual IDB transaction before navigation, independently of wasm.
    const saved = await new Promise((resolve, reject) => {
      const open = indexedDB.open(`snapback4-${encodeURIComponent(`${api}:dev:alice`)}`);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction("changes"), req = tx.objectStore("changes").getAll();
        tx.oncomplete = () => { db.close(); resolve(req.result.filter(c => c.s === "o").map(c => JSON.parse(c.v).id)); };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    if (!writes.every(w => w.state === "pending" && saved.includes(w.id))) throw new Error("write resolved before durable admission");
    // Real full-document navigation immediately after completed admission. It is
    // scheduled so this evaluation can return; the ordinary transport is already
    // stopped, so only the page-exit flush can deliver the writes.
    setTimeout(() => { window.location.href = "about:blank"; }, 0);
    return writes.map(w => w.id);
  }, api);
  await page.waitForURL("about:blank");
  const deadline = Date.now() + 10000;
  let received;
  do {
    received = await rows();
    if (received.length === 1) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  const beforeReopen = received.length;
  // Load the harness again, then replay the durable outbox from its old origin.
  await page.goBack();
  await page.waitForFunction(() => typeof window.createLocalClient === "function");
  await page.evaluate(async api => {
    const client = await window.createLocalClient({ url: api, persona: "alice", waitSeconds: 1 });
    await client.sync();
    const deadline = Date.now() + 10000;
    while (true) {
      const result = await client.query({ kind: "query", name: "thread" }, { conversationId: "c1", c: null });
      if (result.data?.length === 2 && result.data.every(row => !row.pending)) break;
      if (Date.now() > deadline) throw new Error("reopened outbox did not settle");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await client.close();
  }, api);
  const afterReopen = (await rows()).length;
  console.log(JSON.stringify({ witness: "web-navigation", chromium: witness.chromium, durableWrites: writes.length, rowsBeforeReopen: beforeReopen, rowsAfterReopen: afterReopen }));
  assert.equal(beforeReopen, 1, "only the oldest unconfirmed write may dispatch at exit");
  assert.equal(afterReopen, 2, "reopen must not apply either mutation twice");
} finally {
  await witness.close();
}
