// Rule 1: real client session transitions at asynchronous routing boundaries.
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalClient } from "../dist/local.js";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
for (const transition of ["sign-out", "close"]) for (const boundary of ["local", "dispatch", "transport", "delivery", "publication"]) {
  test(`rule 1: ${transition} during ${boundary} cannot publish private data`, { timeout: 10000 }, async t => {
    const backend = { generation: 1, schema: { tables: {} }, programs: [{ name: "secret", kind: "Query", body: [], args: {}, runs: "server" }] };
    const paused = deferred(), release = deferred();
    let armed = false, delivered = false, deliveryChecks = 0, didPause = false, calls = 0;
    const pause = async where => {
      if (armed && boundary === where && !didPause) { didPause = true; paused.resolve(); await release.promise; }
    };
    const core = {
      async call(request) {
        switch (request.op) {
          case "backend": return { ok: backend };
          case "state": return { ok: { watermark: 0, generation: 1 } };
          case "sync_state": return { ok: { receipt_outcomes: true, outbox_status: true, acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [], send_revision: 0 } };
          case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: request.page.send_revision, retired: {}, adoption_capture: {} } };
          case "next_submission": return { ok: 1 };
          case "meta": case "set_meta": return { ok: null };
          case "apply": return { ok: { touched: [] } };
          case "queued":
            await pause(delivered ? (++deliveryChecks === 1 ? "delivery" : "publication") : "dispatch");
            return { ok: [] };
          case "query":
            await pause("local");
            return { ok: boundary === "local" ? { data: "private local result", unknown: false, complete: true, tables: [] } : { loading: true, unknown: true, tables: [] } };
          default: throw Error(`unexpected ${request.op}`);
        }
      }, async close() {},
    };
    const client = await createLocalClient({ url: "http://query-publication-session.invalid", persona: "alice", device: { open: async () => core }, fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") return Response.json({ snapshot: true, events: [], watermark: 0, more: false, generation: 1 });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path === "/q/secret") { calls++; await pause("transport"); delivered = true; return Response.json({ data: "private server result", complete: true }); }
      if (path === "/auth/logout") return Response.json({ ok: true });
      throw Error(`unexpected ${path}`);
    } });
    t.after(async () => { release.resolve(); await client.close(); });
    await client.sync(); armed = true;
    const read = client.query({ kind: "query", name: "secret" }, {});
    await paused.promise;
    const ending = transition === "close" ? client.close() : client.signOut();
    // Close sets the fence synchronously but waits for the active query to settle.
    if (transition === "sign-out") {
      for (let i = 0; i < 100 && client.link() !== "signed-out"; i++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(client.link(), "signed-out");
    }
    release.resolve();
    const result = await read;
    assert.ok((transition === "close" ? ["E_CLOSED"] : ["E_AUTH", "E_CLOSED"]).includes(result.denied?.code), JSON.stringify(result));
    assert.equal("data" in result, false);
    assert.equal(calls, ["local", "dispatch"].includes(boundary) ? 0 : 1);
    await ending;
  });
}
