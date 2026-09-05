import assert from "node:assert/strict";
import { test } from "node:test";
import { witnessControl } from "../dist/expo/witness.mjs";
class Socket {
  static all: Socket[] = [];
  readyState = 1;
  onmessage?: (value: { data: string }) => void;
  onopen?: () => void;
  onclose?: () => void;
  sent: any[] = [];
  constructor(_url: string) { Socket.all.push(this); queueMicrotask(() => this.onopen?.()); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  command(id: number, verb: string, args: unknown = {}) { this.onmessage?.({ data: JSON.stringify({ id, verb, args }) }); }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test("witness connects before construction; persistent faults are reported over the surviving control connection", async () => {
  const Original = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  let constructed = 0, fault = false;
  const control = witnessControl({
    async persist(change) { fault = change.fault === "carrier"; },
    async construct() { constructed++; if (fault) throw new Error("E_OFFLINE_CARRIER"); return { ready: Promise.resolve(), snapshot: {} } as any; },
  }, "ws://localhost:43219");
  try {
    await tick();
    const socket = Socket.all.at(-1)!;
    assert.deepEqual(socket.sent[0], { event: "connected", value: { constructed: false } });
    assert.equal(constructed, 0);
    socket.command(1, "fault", { mode: "carrier" }); await tick();
    socket.command(2, "construct"); await tick();
    assert.equal(socket.sent.at(-1).ok, false); assert.match(socket.sent.at(-1).error.message, /E_OFFLINE_CARRIER/);
    socket.command(3, "fault", { mode: "none" }); await tick();
    socket.command(4, "construct"); await tick();
    assert.equal(socket.sent.at(-1).ok, true); assert.equal(constructed, 2);
    socket.command(5, "login", { name: "alice" }); await tick();
    assert.equal(socket.sent.at(-1).ok, false); assert.equal(constructed, 2, "login is not a second construct");
  } finally { control.close(); globalThis.WebSocket = Original; }
});

test("witness barrier remains parked on socket close and only barrier(off) releases it", async () => {
  const Original = globalThis.WebSocket;
  globalThis.WebSocket = Socket as any;
  let commits = 0;
  const control = witnessControl({
    async construct() { return { ready: Promise.resolve(), snapshot: {} } as any; },
    async command(_client, verb, _args, hooks) { assert.equal(verb, "swap"); await hooks.beforeCommit({} as any, { put: [], remove: [] }); commits++; return {}; },
  }, "ws://localhost:43219");
  try {
    const socket = Socket.all.at(-1)!;
    socket.command(1, "construct"); await tick();
    socket.command(2, "barrier", { mode: "on" }); await tick();
    socket.command(3, "swap"); await tick();
    assert.ok(socket.sent.some((item) => item.event === "barrier reached"));
    assert.equal(commits, 0);
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 275));
    assert.equal(commits, 0, "socket close never releases COMMIT");
    const reconnected = Socket.all.at(-1)!;
    assert.notEqual(reconnected, socket);
    reconnected.command(4, "barrier", { mode: "off" }); await tick();
    assert.equal(commits, 1);
  } finally { control.close(); globalThis.WebSocket = Original; }
});
