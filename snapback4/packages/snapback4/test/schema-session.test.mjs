import test from "node:test";
import assert from "node:assert/strict";
import { createLocalClient } from "../dist/local.js";
import { keepSession, restoreSession } from "../dist/auth.js";

for (const [status, code, retryable, auth] of [
  [503, "E_STORE", true, false],
  [503, "E_AUTH", true, false],
  [403, "E_STORE", false, false],
  [200, "E_STORE", true, false],
  [403, "E_AUTH", undefined, true],
  [401, "E_AUTH", true, true],
  [401, undefined, undefined, true],
]) {
  test(`schema startup ${status}/${code ?? "no refusal"}/${retryable}: ${auth ? "forgets refused session" : "keeps saved session connected"}`, async t => {
    const base = "https://schema-session.invalid";
    const session = { principal: "user:alice", kind: "user", token: "saved-bearer", expiresAt: Date.now() + 7 * 86400_000 };
    const stored = new Map();
    let deletions = 0, opens = 0;
    const sessionStore = {
      async get(key) { return stored.get(key) ?? null; },
      async set(key, value) { stored.set(key, value); },
      async delete(key) { deletions++; stored.delete(key); },
    };
    await keepSession(base, session, sessionStore);
    const before = new Map(stored);
    const backend = { generation: 1, schema: { tables: {} }, programs: [] };
    const paths = [];
    const opening = createLocalClient({ url: base, sessionStore,
      device: { async open(_name, initial) {
        opens++;
        assert.equal(initial, null, "open the kept device without installing the refused schema");
        return { async close() {}, async call({ op }) {
          if (op === "sync_state") return { ok: { acquired: true, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [] } };
          if (op === "state") return { ok: { watermark: 0, generation: 1, native: null } };
          if (op === "backend") return { ok: backend };
          if (op === "meta") return { ok: null };
          if (op === "queued") return { ok: [] };
          return { ok: true };
        } };
      } },
      fetch: async (url, init) => {
        paths.push(new URL(url).pathname);
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer saved-bearer");
        return Response.json(code ? { denied: { code, family: code === "E_AUTH" ? "auth" : "store", message: "reader unavailable", ...(retryable === undefined ? {} : { retryable }) } } : {}, { status });
      },
    });
    if (auth) {
      await assert.rejects(opening, /createLocalClient: E_AUTH:/);
      assert.equal(opens, 0, "a real auth refusal must not open the replica");
      assert.equal(deletions, 1);
      assert.equal(await restoreSession(base, sessionStore), null);
    } else {
      const client = await opening;
      t.after(() => client.close());
      assert.equal(opens, 1);
      assert.equal(client.link(), "online");
      assert.equal(client.viewer(), session.principal);
      assert.deepEqual(client.session(), session);
      assert.deepEqual(await restoreSession(base, sessionStore), session);
      assert.deepEqual(stored, before, "startup preserves the exact saved session bytes");
      assert.equal(deletions, 0);
      await client.close();
      assert.deepEqual(stored, before, "ordinary close also preserves the session");
      assert.equal(deletions, 0);
    }
    assert.equal(paths[0], "/schema");
  });
}
