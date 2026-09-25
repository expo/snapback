// Drive the two observations of a composed read independently. Real device
// integration and native guest execution are covered in bounded-following.
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalClient } from "../dist/local.js";

for (const scenario of ["server", "offline", "pending", "transport recovered"]) {
  test(`Following becomes withheld on composed re-observation: ${scenario}`, async t => {
    const backend = {
      generation: 1,
      schema: { tables: {}, timelines: [{ name: "feed", posts: ["posts"], reposts: ["reposts"] }] },
      programs: [
        { name: "read", kind: "Query", args: {}, body: [] },
        { name: "probe", kind: "Query", args: {}, body: [], runs: "server" },
      ],
    };
    const input = { c: "original-cursor" }, requests = [];
    let client, observations = 0, pending = false, recover, recovering;
    const recovery = new Promise(resolve => { recover = resolve; });
    const core = {
      async call(request) {
        switch (request.op) {
          case "backend": return { ok: backend };
          case "state": return { ok: { watermark: 0, generation: 1 } };
          case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation: 1, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [], send_revision: 0 } };
          case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: request.page.send_revision, retired: {}, adoption_capture: {} } };
          case "next_submission": return { ok: 1 };
          case "meta": return { ok: null };
          case "set_meta": case "adopt": return { ok: null };
          case "apply": return { ok: { touched: [] } };
          case "queued": return { ok: pending ? [{ id: "pending", predictable: true, observed_seq: null, predicted: [] }] : [] };
          case "query": {
            assert.equal(request.name, "read");
            assert.deepEqual(request.args, input);
            if (++observations === 1) return { ok: {
              data: { kept: ["local"], current: [] }, complete: false, unknown: true, tables: ["feedFeed"],
              components: { kept: { complete: true, retained: true }, current: { complete: false, unknown: true } },
            } };
            assert.equal(observations, 2);
            pending = scenario === "pending";
            // A separate successful request can restore the link before this
            // local reply, without making the failed composed fallback succeed.
            if (scenario === "transport recovered") {
              recover();
              await recovering;
              assert.equal(client.link(), "online");
            }
            return { ok: { loading: true, unknown: true, tables: ["posts", "feedFeed"] } };
          }
          default: throw Error(`unexpected device call ${request.op}`);
        }
      },
      async close() {},
    };
    client = await createLocalClient({ url: "http://following-routing.invalid", persona: "alice", device: { open: async () => core }, fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") return Response.json({ snapshot: true, events: [], watermark: 0, more: false, generation: 1 });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path === "/q/probe") { await recovery; return Response.json({ data: true, complete: true }); }
      if (path === "/q/read") {
        requests.push(JSON.parse(init.body));
        if (["offline", "transport recovered"].includes(scenario)) throw new TypeError("transport failed");
        return Response.json({ data: { kept: ["server"], current: ["original"] }, complete: true });
      }
      throw Error(`unexpected fetch ${path}`);
    } });
    t.after(() => client.close());
    await client.sync();
    if (scenario === "transport recovered") recovering = client.query({ kind: "query", name: "probe" }, {});
    const result = await client.query({ kind: "query", name: "read" }, input);
    assert.equal(observations, 2);
    assert.deepEqual(requests, [{ args: input }]);
    if (scenario === "server") assert.deepEqual(result.data, { kept: ["server"], current: ["original"] });
    else assert.deepEqual(result, { loading: true });
  });
}
