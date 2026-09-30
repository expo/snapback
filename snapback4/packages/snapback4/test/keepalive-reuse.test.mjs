import test from "node:test";
import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { server } from "./helpers/app-server.mjs";

const source = `use personas alice
table items:
  body: text <=100
  read <- allow
  insert <- allow
mutation add():
  insert items { body: 'once' }
query ping():
  return 1
query count():
  return count(items[] first 100 by byId)
`;
const ping = { kind: "query", name: "ping" };
const block = ms => { const until = performance.now() + ms; while (performance.now() < until) {} };
const selectedFetch = process.env.KA_BASELINE_FETCH ? (await import(new URL("../../../reports/20260930-ka-keepalive-reuse/baseline-node-fetch.js", import.meta.url))).defaultFetch : undefined;

// No fake fetch or socket error: delay the actual writer after it has selected
// an idle socket. This is the race left after undici's idle validation turn.
for (let round = 0; round < Number(process.env.KA_ROUNDS ?? 1); round++) test(`Node SDK query survives a client pause across the dev idle deadline (${round})`, { timeout: 30_000 }, async t => {
  const { url } = await server(t, undefined, source);
  const clients = Array.from({ length: Number(process.env.KA_CLIENTS ?? 1) }, () => createClient({ url, persona: "alice", ...(selectedFetch ? { fetch: selectedFetch } : {}) }));
  t.after(() => Promise.all(clients.map(client => client.close())));
  const sends = channel("undici:client:sendHeaders");
  const failures = channel("undici:request:error");
  const errors = [], sockets = new Map();
  let armed = false, pauses = 0;
  const sending = ({ request, socket }) => {
    if (String(request.origin) !== url || request.path !== "/q/ping") return;
    const prior = sockets.get(socket);
    sockets.set(socket, performance.now());
    if (armed && prior !== undefined && pauses === 0 && process.env.KA_PHASE !== "before-selection") { pauses++; block(Number(process.env.KA_BLOCK_MS ?? 1800)); }
  };
  const failed = ({ request, error }) => {
    if (String(request.origin) === url) errors.push({ path: request.path, code: error.code, message: error.message });
  };
  sends.subscribe(sending); failures.subscribe(failed);
  t.after(() => { sends.unsubscribe(sending); failures.unsubscribe(failed); });
  const warm = await Promise.all(clients.map(client => client.query(ping, {})));
  assert.ok(warm.every(read => read.data === 1), JSON.stringify(warm));
  await delay(Number(process.env.KA_IDLE_MS ?? 3500));
  if (process.env.KA_PHASE === "before-selection") { pauses++; block(Number(process.env.KA_BLOCK_MS ?? 1800)); }
  armed = true;
  const reads = await Promise.all(clients.map(client => client.query(ping, {})));
  console.log(JSON.stringify({ round, clients: clients.length, phase: process.env.KA_PHASE ?? "selected-socket", idleMs: Number(process.env.KA_IDLE_MS ?? 3500), blockMs: Number(process.env.KA_BLOCK_MS ?? 1800), pauses, errors, failedReads: reads.filter(read => read.data !== 1), successes: reads.filter(read => read.data === 1).length }));
  assert.ok(reads.every(read => read.data === 1), JSON.stringify(reads));
});
