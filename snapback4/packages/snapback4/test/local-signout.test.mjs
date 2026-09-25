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
      if (op === "sync_state") return { ok: { acquired: true, backend_required: false, store_id: null, watermark: 0, generation: 1, send_revision: 0, restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, adoption_capture: {}, pending_ids: [] } };
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

for (const stage of ["request", "request ignoring abort", "body ignoring abort"]) {
  test(`sign-out revokes a delayed refresh ${stage} without adopting it`, async t => {
    const entered = deferred(), release = deferred(), revoked = deferred();
    const original = "Bearer fixture-original", successor = "Bearer fixture-delayed";
    const logoutBearers = [];
    let signal, liveBearer = original;
    const f = await fixture(t, {
      release: () => release.resolve(),
      refresh: async init => {
        signal = init.signal;
        // Model the server's commit: the old bearer is already retired.
        liveBearer = successor;
        if (!stage.startsWith("body")) {
          entered.resolve();
          if (stage === "request") await new Promise((resolve, reject) => {
            const stop = () => reject(Error("refresh aborted after server commit"));
            if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
            void release.promise.then(resolve);
          });
          else await release.promise;
        }
        const response = Response.json({ session: session("fixture-delayed") });
        if (stage.startsWith("body")) {
          response.json = async () => { entered.resolve(); await release.promise; return { session: session("fixture-delayed") }; };
        }
        return response;
      },
      logout: init => {
        const bearer = new Headers(init.headers).get("authorization");
        logoutBearers.push(bearer);
        if (bearer !== liveBearer) return Response.json({ denied: { code: "E_AUTH" } }, { status: 401 });
        liveBearer = null; revoked.resolve();
        return Response.json({ ok: true });
      },
    });
    const observed = [];
    f.client.onSession(value => observed.push(value === null ? "ended" : "replacement"));
    const rotating = f.client.refreshSession();
    await entered.promise;
    await promptly(f.client.signOut());
    assert.notEqual(signal?.aborted, true, "do not discard a committed rotation's successor");
    assert.equal((await rotating).ok, false);
    assert.equal(await f.reload(), null);
    assert.ok(logoutBearers.length === 1 && logoutBearers[0] === original, "the original bearer was tried without waiting for refresh");
    assert.ok(liveBearer === successor, "the retired bearer cannot revoke the successor's family");
    release.resolve(); await promptly(revoked.promise);
    assert.ok(logoutBearers.length === 2 && logoutBearers[1] === successor, "the late successor is also presented for logout");
    assert.equal(liveBearer, null, "the server's live family was revoked");
    assert.equal(await f.reload(), null, "late refresh cannot resurrect durable credentials");
    assert.deepEqual(observed, ["ended"]);
    assert.equal(f.client.session(), null);
  });
}

test("sign-out completes locally when refresh never returns", async t => {
  const entered = deferred();
  const f = await fixture(t, { refresh: () => { entered.resolve(); return new Promise(() => {}); } });
  const rotating = f.client.refreshSession();
  await entered.promise;
  await promptly(f.client.signOut());
  assert.equal((await rotating).ok, false);
  assert.equal(await f.reload(), null);
  assert.equal(f.logoutCalls(), 1);
  assert.equal(f.closes(), 1);
});

test("sign-out retains an already-resolved rotation until its adoption microtask", async t => {
  const ending = deferred(), revoked = deferred();
  const logoutBearers = [];
  let beforeAdoption = false;
  const f = await fixture(t, {
    refresh: () => {
      const response = Response.json({});
      response.json = () => {
        // The inner callback runs after auth.ts resolves rotateSession,
        // but before Promise.race resumes the client's adoption work.
        queueMicrotask(() => queueMicrotask(() => {
          beforeAdoption = f.client.session()?.token === "fixture-original";
          ending.resolve(f.client.signOut());
        }));
        return Promise.resolve({ session: session("fixture-resolved") });
      };
      return response;
    },
    logout: init => {
      const bearer = new Headers(init.headers).get("authorization");
      logoutBearers.push(bearer);
      if (bearer === "Bearer fixture-resolved") revoked.resolve();
      return Response.json({ ok: true });
    },
  });
  const rotating = f.client.refreshSession();
  await promptly(ending.promise);
  await promptly(revoked.promise);
  assert.equal(beforeAdoption, true);
  assert.equal((await rotating).ok, false);
  assert.ok(logoutBearers.includes("Bearer fixture-original") && logoutBearers.includes("Bearer fixture-resolved"));
  assert.equal(await f.reload(), null);
  assert.equal(f.client.session(), null);
});

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

test("ordinary close detaches an unread rotation and retires its later successor", async t => {
  const entered = deferred(), release = deferred();
  const f = await fixture(t, { release: () => release.resolve(), refresh: async () => {
    entered.resolve(); await release.promise;
    return Response.json({ session: session("fixture-after-close") });
  } });
  const rotating = f.client.refreshSession();
  await entered.promise;
  await promptly(f.client.close());
  assert.equal((await rotating).ok, false);
  assert.equal((await f.reload())?.token, "fixture-original");
  release.resolve(); await tick();
  assert.equal((await f.reload())?.token, "fixture-original", "the unread successor is never installed after close");
  assert.equal(f.logoutCalls(), 1, "the late unkept successor is retired once");
});
