import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalClient } from "../dist/local.js";
import { restoreSession } from "../dist/auth.js";

const base = "https://local-signout.invalid";
const session = token => ({ principal: "user:alice", kind: "user", token, expiresAt: Date.now() + 7 * 86400_000 });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function promptly(work) {
  let timer;
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("local sign-out waited for the network")), 1000); })]); }
  finally { clearTimeout(timer); }
}
function fileStore(directory, hooks = {}) {
  const path = join(directory, "session.json");
  return {
    async get() { try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
    async set(_key, value) { await hooks.beforeSet?.(); await writeFile(path, value); },
    async delete() { await hooks.beforeDelete?.(); await rm(path, { force: true }); },
  };
}
async function fixture(t, hooks = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sb4-signout-"));
  const store = fileStore(directory, hooks);
  const backend = { generation: 1, schema: { tables: {} }, programs: [] };
  let closes = 0, logoutCalls = 0;
  const core = {
    async call({ op, key }) {
      if (op === "set_meta" && key === "media:manifest") await hooks.beforeMediaSave?.();
      if (op === "sync_state") return { ok: { acquired: true, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: [] } };
      if (op === "state") return { ok: { watermark: 0, generation: 1, native: null } };
      if (op === "backend") return { ok: backend };
      if (op === "meta") return { ok: null };
      if (op === "queued") return { ok: [] };
      if (op === "apply") return { ok: { touched: [] } };
      return { ok: true };
    },
    async close() { closes++; },
  };
  const client = await createLocalClient({
    url: base, session: session("fixture-original"), sessionStore: store,
    device: { open: async () => core },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") return Response.json({ snapshot: false, events: [], watermark: 0, more: false, generation: 1, acknowledged: [] });
      if (path === "/changes") return new Promise((_, reject) => {
        const stop = () => reject(new Error("aborted"));
        if (init.signal.aborted) stop(); else init.signal.addEventListener("abort", stop, { once: true });
      });
      if (path === "/auth/refresh") return hooks.refresh?.(init) ?? Response.json({ session: session("fixture-replacement") });
      if (path === "/auth/logout") { logoutCalls++; return hooks.logout?.(init) ?? Response.json({ ok: true }); }
      throw Error(`unexpected fixture route ${path}`);
    },
  });
  t.after(async () => { await hooks.release?.(); await client.close(); await rm(directory, { recursive: true, force: true }); });
  return { client, store, reload: () => restoreSession(base, fileStore(directory)), closes: () => closes, logoutCalls: () => logoutCalls };
}

test("local sign-out completes with logout stalled and a fresh store cannot reopen the old account", async t => {
  const f = await fixture(t, { logout: () => new Promise(() => {}) });
  await promptly(f.client.signOut());
  assert.equal(f.logoutCalls(), 1);
  assert.equal(f.client.session(), null);
  assert.equal(f.client.link(), "signed-out");
  assert.equal(await f.reload(), null, "a newly opened persistent store has no session");
  let deviceOpened = false;
  await assert.rejects(createLocalClient({ url: base, sessionStore: f.store,
    device: { open: async () => { deviceOpened = true; throw Error("old replica must not open"); } },
    fetch: async () => { throw Error("offline"); },
  }), /no session/);
  assert.equal(deviceOpened, false);
  assert.equal(f.closes(), 1);
});

for (const stage of ["request", "body"]) {
  test(`sign-out fences a delayed refresh ${stage}, including transports that ignore abort`, async t => {
    const entered = deferred(), release = deferred();
    let signal;
    const f = await fixture(t, {
      release: () => release.resolve(),
      refresh: async init => {
        signal = init.signal;
        if (stage === "request") { entered.resolve(); await release.promise; }
        const response = Response.json({ session: session("fixture-delayed") });
        if (stage === "body") {
          response.json = async () => { entered.resolve(); await release.promise; return { session: session("fixture-delayed") }; };
        }
        return response;
      },
    });
    const observed = [];
    f.client.onSession(value => observed.push(value === null ? "ended" : "replacement"));
    const rotating = f.client.refreshSession();
    await entered.promise;
    await promptly(f.client.signOut());
    assert.equal(signal.aborted, true);
    assert.equal((await rotating).ok, false);
    assert.equal(await f.reload(), null);
    release.resolve(); await tick();
    assert.equal(await f.reload(), null, "late refresh cannot resurrect durable credentials");
    assert.deepEqual(observed, ["ended"]);
    assert.equal(f.client.session(), null);
  });
}

test("sign-out deletes after an already-started persistent refresh write, never before it", async t => {
  const saving = deferred(), release = deferred();
  let hold = false;
  const f = await fixture(t, { beforeSet: async () => { if (hold) { saving.resolve(); await release.promise; } }, release: () => release.resolve() });
  hold = true;
  const rotating = f.client.refreshSession();
  await saving.promise;
  let completed = false;
  const ending = f.client.signOut().then(() => { completed = true; });
  await tick();
  assert.equal(completed, false, "completion waits for durable credential deletion");
  release.resolve();
  await promptly(ending);
  assert.equal((await rotating).ok, false);
  assert.equal(await f.reload(), null, "the late store write is followed by deletion");
});

test("a failed credential deletion rejects sign-out and can be retried", async t => {
  let refuse = true;
  const f = await fixture(t, { beforeDelete: () => { if (refuse) throw Error("session storage unavailable"); } });
  await assert.rejects(f.client.signOut(), /session storage unavailable/);
  assert.ok(await f.reload(), "failure must not claim the persistent credential is gone");
  assert.equal(f.client.session(), null, "the running client remains fenced");
  refuse = false;
  await promptly(f.client.signOut());
  assert.equal(await f.reload(), null);
});

test("media cleanup cannot postpone durable credential deletion", async t => {
  const clearing = deferred(), release = deferred();
  let hold = false;
  const f = await fixture(t, { beforeMediaSave: async () => { if (hold) { clearing.resolve(); await release.promise; } }, release: () => release.resolve() });
  hold = true;
  const ending = f.client.signOut();
  await clearing.promise;
  assert.equal(await f.reload(), null, "credentials are gone even while media cleanup is stalled");
  release.resolve();
  await promptly(ending);
});

test("ordinary close still preserves a rotated session that completes after close begins", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { release: () => release.resolve(), refresh: async () => {
    entered.resolve(); await release.promise;
    return Response.json({ session: session("fixture-after-close") });
  } });
  const rotating = f.client.refreshSession();
  await entered.promise;
  const closing = f.client.close();
  release.resolve();
  assert.equal((await rotating).ok, true);
  await closing;
  assert.ok((await f.reload())?.token === "fixture-after-close", "ordinary close keeps the server's replacement credential");
  assert.equal(f.logoutCalls(), 0);
});
