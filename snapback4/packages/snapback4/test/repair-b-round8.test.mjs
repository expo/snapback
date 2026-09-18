import test from "node:test";
import assert from "node:assert/strict";

test("publication notifies watches even when its following state read fails; retry uses durable progress", { timeout: 5000 }, async t => {
  const { createLocalClient } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  const backend = { generation: 1, schema: { tables: {}, operations: { counter: { runs: "device", held: true } } }, programs: [] };
  let value = 1, watermark = 5, advance = false, denyRead = false, denials = 0;
  const requests = [];
  const core = { close: async () => {}, call: async request => {
    switch (request.op) {
      case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } };
      case "backend": return { ok: backend };
      case "meta": return { ok: null };
      case "state": return { ok: { watermark, generation: 1 } };
      case "queued": return { ok: [] };
      case "next_submission": return { ok: 1 };
      case "sync_state":
        if (denyRead && request.capture === false) {
          denyRead = false; denials++;
          return { denied: { code: "E_STORE", family: "store", message: "injected post-publication read failure" } };
        }
        return { ok: { acquired: true, backend_required: false, generation: 1, store_id: "S",
          watermark, transfer_watermark: watermark, snapshot_catchup: false,
          pending_ids: [], pending_through: 0, pending_complete: true, pending_bound: 0, send_revision: 0 } };
      case "apply":
        if (advance) { advance = false; value = 2; watermark = 9; denyRead = true; return { ok: { touched: ["counters"], published: true } }; }
        return { ok: { touched: [], published: true } };
      case "query": return { ok: { data: value, complete: true, tables: ["counters"] } };
      case "set_meta": case "keep_write": return { ok: null };
      default: throw new Error(`unexpected operation ${request.op}`);
    }
  } };
  const client = await createLocalClient({ url: "http://published-read-r8.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/probe") return Response.json({ ok: true, store_id: "S", seq: watermark });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path !== "/sync") throw new TypeError("background transport held");
      requests.push(JSON.parse(init.body).from);
      return Response.json({ snapshot: false, store_id: "S", events: [], watermark: advance ? 9 : watermark,
        images_at: advance ? 9 : watermark, more: false, generation: 1 });
    },
  });
  const watch = client.observe({ kind: "query", name: "counter", held: true }, {});
  t.after(async () => { watch.close(); await client.close(); });
  const notifications = [];
  watch.subscribe(() => notifications.push(watch.getSnapshot().data));
  const waitFor = async value => { for (let i = 0; i < 50 && watch.getSnapshot().data !== value; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
  await waitFor(1);
  assert.equal(watch.getSnapshot().data, 1);
  advance = true;
  await client.sync();
  assert.equal(denials, 1);
  await waitFor(2);
  assert.equal(watch.getSnapshot().data, 2, "committed row changes still invalidate watches when the following read fails");
  assert.ok(notifications.includes(2));
  await client.sync();
  assert.deepEqual(requests, [5, 5, 9], "retry captures durable native progress before fetching");
});
