import { createRequire } from "node:module";
import { resolve } from "node:path";
import { packageRoot } from "../expo-project.mjs";

export async function controlServer(port) {
  const require = createRequire(resolve(packageRoot, "package.json"));
  const { WebSocketServer } = require("ws");
  const server = new WebSocketServer({ port, host: "127.0.0.1" });
  await new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
  let socket, nextId = 0;
  let generation = 0;
  const pending = new Map();
  const events = [];
  const reset = () => {
    const stale = socket;
    socket = undefined;
    events.length = 0;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("app disconnected")); }
    pending.clear();
    stale?.terminate();
  };
  server.on("connection", (value) => {
    if (socket && socket.readyState < 2) { value.close(1008, "one witness control connection at a time"); return; }
    socket = value; generation++;
    events.length = 0;
    socket.on("message", (data) => {
      if (socket !== value) return;
      const message = JSON.parse(String(data));
      if (message.event) { events.push(message); return; }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.ok) request.resolve(message.result);
      else request.reject(Object.assign(new Error((message.error?.message ?? "witness command failed") + (message.error?.stack ? `\n${message.error.stack}` : "")), { envelope: message.error }));
    });
    socket.on("close", () => {
      if (socket !== value) return;
      for (const [id, request] of pending) { clearTimeout(request.timer); request.reject(new Error("app disconnected")); pending.delete(id); }
    });
  });
  const until = async (predicate, label, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  return {
    reset,
    get port() { return server.address().port; },
    get generation() { return generation; },
    async connected(after = 0) { await until(() => generation > after && events.some((item) => item.event === "connected"), "app outward connection"); },
    async event(name) { await until(() => events.some((item) => item.event === name), name); return events.splice(events.findIndex((item) => item.event === name), 1)[0]; },
    command(verb, args = {}, timeout = 30_000) {
      return new Promise((resolve, reject) => {
        if (!socket || socket.readyState !== 1) { reject(new Error("app is not connected")); return; }
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`command timeout: ${verb}`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, verb, args }));
      });
    },
    close() { for (const client of server.clients) client.terminate(); return new Promise((resolve) => server.close(resolve)); },
  };
}
