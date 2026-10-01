import { waitFor as awaitState } from './helpers/wait.mjs';
// Deterministic transport barriers around the real wasm device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
export const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
export const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
export const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
export async function until(check) { return awaitState(check); }
const events = (store, count = 1) => [
  { table: "conversations", id: "c1", title: store, creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  ...Array.from({ length: count }, (_, i) => ({ table: "messages", id: `${store}-${i}`, conversationId: "c1", authorId: "dev:alice", body: store, at: i + 1, editedAt: null, photo: null })),
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const backend = store => ({ ...original, programs: [...original.programs, { name: "marker", kind: "Query", args: {}, body: [{ Return: { Literal: { String: store } } }] }] });
const snapshot = (store, count = 1) => ({ snapshot: true, store_id: store, generation: 1, events: events(store, count), watermark: 10, more: false });

export async function fixture(t, count = 1, hooks = {}) {
  const persist = memoryPersistence();
  let store = "A", generation = 1, marker = "A", offline = false, schemaFailures = 0, core, client, changes;
  let schema = original.schema;
  let queryGate, localGate, mutationGate, syncGate, localStarts = 0, queryStarts = 0, schemaCalls = 0, mutationStarts = 0, syncStarts = 0;
  const reads = [], clients = [], sends = [], syncRequests = [];
  let queryUnavailable = false, refuseSecond = false, beforeSend, beforeCall, afterCall, exitRefusal;
  let adopting, committed, resetReadFailure, failNextResetRead = false, failureOp = "observe_store";
  const fetcher = async (input, init = {}) => {
    if (offline && !init.keepalive) throw new TypeError("offline");
    const path = new URL(input).pathname;
    const override = await hooks.fetch?.(path, init);
    if (override) return override;
    if (path === "/schema") { schemaCalls++; if (schemaFailures-- > 0) throw new TypeError("schema interrupted"); return Response.json({ ...backend(marker), schema, generation }); }
    if (path === "/sync") {
      syncStarts++;
      if (syncGate) await syncGate.promise;
      const request = JSON.parse(init.body);
      syncRequests.push(request);
      if (refuseSecond && sends.length > 0 && request.from !== 0) {
        const committed = events(store).filter(e => e.table === "messages");
        committed[0].data.body = "committed first";
        return Response.json({ snapshot: false, store_id: store, generation, events: committed, watermark: 11, more: false });
      }
      return Response.json(request.from === 0 && !request.stream ? { ...snapshot(store, count), generation } : { snapshot: false, store_id: store, generation, events: [], watermark: 10, more: false });
    }
    if (path === "/changes") {
      const current = changes = gate();
      const abort = () => current.resolve({ seq: 10, store_id: store });
      init.signal?.addEventListener("abort", abort, { once: true });
      try { return Response.json(await current.promise); } finally { init.signal?.removeEventListener("abort", abort); }
    }
    if (path.startsWith("/q/")) {
      const captured = marker; queryStarts++;
      if (queryGate) await queryGate.promise;
      reads.push(captured);
      return Response.json(queryUnavailable ? { loading: true } : { data: captured, complete: true, tables: ["messages"] });
    }
    if (path.startsWith("/m/")) { if (init.keepalive && exitRefusal) return Response.json({ state: "failed", why: exitRefusal }); sends.push({ ...JSON.parse(init.body), store, exit: !!init.keepalive }); mutationStarts++; if (mutationGate) await mutationGate.promise;
      if (refuseSecond && sends.length === 2) return Response.json({ state: "failed", why: { code: "SECOND_REFUSED", family: "application", message: "second write refused", retryable: false } });
      return Response.json({ state: "sent", seq: 11 }); }
    if (path === "/probe") return Response.json({ ok: true });
    assert.fail(path);
  };
  async function open() {
    const opener = (hooks.webDevice ?? webDevice)({ wasm, persist });
    client = await (hooks.createLocalClient ?? createLocalClient)({ url: `http://reset.test/${encodeURIComponent(t.name)}`, persona: "alice", device: { async open(...a) { const opened = core = await opener.open(...a); return { ...opened, ...(hooks.onSuspend ? {onSuspend:hooks.onSuspend} : {}), async call(request, committedReply) {
      const intercepted = await beforeCall?.(request);
      if (intercepted) return intercepted;
      const override = await hooks.beforeCall?.(request);
      if (override) return override;
      if (request.op === "begin_send" && beforeSend) {
        const reply = await beforeSend(request);
        if (reply) return reply;
      }
      if (request.op === "sync_state" && failNextResetRead) {
        failNextResetRead = false;
        resetReadFailure();
        return { denied: { code: "E_STORE", family: "store", message: "injected post-reset read failure" } };
      }
      if (request.op === "adopt") adopting?.();
      const reply = await opened.call(request, committedReply);
      if (!reply.denied) committed?.(request, reply.ok);
      if (request.op === failureOp && !reply.denied && (failureOp === "adopt" || reply.ok?.reset) && resetReadFailure) failNextResetRead = true;
      await afterCall?.(request, reply);
      await hooks.afterCall?.(request, reply);
      if (request.op === "query" && localGate) { localStarts++; await localGate.promise; }
      return reply;
    } }; } }, fetch: (input, init) => fetcher(String(input).replace(`/${encodeURIComponent(t.name)}`, ""), init) });
    clients.push(client); return client;
  }
  t.after(async () => { queryGate?.resolve(); localGate?.resolve(); mutationGate?.resolve(); syncGate?.resolve(); for (const c of clients) { const closing = c.close(); await hooks.closing?.(); await closing; } });
  await open();
  return { get client() { return client; }, get core() { return core; }, get changesWaiting() { return !!changes; }, open, persist, reads, sends, syncRequests,
    unavailable(value) { queryUnavailable = value; },
    refuseSecond() { refuseSecond = true; },
    beforeSend(callback) { beforeSend = callback; },
    beforeCall(callback) { beforeCall = callback; }, afterCall(callback) { afterCall = callback; },
    refuseExit(why) { exitRefusal = why; },
    replace() { store = marker = "B"; }, updateBackend() { generation++; marker = "A2"; }, offline(v) { offline = v; }, failSchema(n) { schemaFailures = n; },
    widenBackend() {
      generation++; marker = "A2"; schema = structuredClone(schema);
      schema.tables.conversations.columns.tag = { Text: { max: 20 } };
      schema.tables.conversations.defaults = { tag: { Literal: { String: "default" } } };
    },
    onAdopt(callback) { adopting = callback; },
    onCommit(callback) { committed = callback; },
    failReadAfterReset(callback, op = "observe_store") { resetReadFailure = callback; failureOp = op; },
    stats() { return { queryStarts, localStarts, schemaCalls, mutationStarts, syncStarts }; },
    holdLocal() { return localGate = gate(); },
    holdSync() { return syncGate = gate(); },
    holdQueries() { return queryGate = gate(); }, holdMutation() { return mutationGate = gate(); },
    async changed(seq = 10) { await until(() => changes); const c = changes; changes = null; c.resolve({ seq, store_id: store, generation: 1 }); await tick(); },
  };
}
