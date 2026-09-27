// Preloaded only in a disposable consumer running the unchanged production proof.
import assert from "node:assert/strict";
import cp from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";

const root = process.cwd(), scenario = process.env.ROUNDTRIP_SCENARIO;
const record = value => appendFileSync(join(root, "events.jsonl"), JSON.stringify(value) + "\n");
const refuse = operation => { if (scenario === operation) throw new Error(`injected ${operation} failure`); };
let child;
cp.execFileSync = (command, args, options) => {
  record({ event: "cli", command, args, ...options });
  const operation = args[2]; refuse(operation);
  return operation === "--version" ? `snapback4 ${scenario === "version" ? "wrong-version" : process.argv[2]}\n` : "";
};
cp.spawn = (command, args, options) => {
  record({ event: "spawn", command, args, ...options });
  child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 424242,
  });
  setImmediate(() => {
    if (scenario === "dev") {
      child.stderr.emit("data", "injected dev failure"); child.exitCode = 1; child.emit("exit", 1);
    } else {
      child.stdout.emit("data", "http://127.0.0.1:43210\n");
    }
  });
  return child;
};
process.kill = (pid, signal) => {
  assert.equal(pid, -child.pid); assert.equal(signal, "SIGTERM");
  record({ event: "kill", pid, signal });
  child.exitCode = 0; child.emit("exit", 0);
  return true;
};
syncBuiltinESMExports();

export function createClient(options) {
  record({ event: "client", ...options });
  const { persona } = options;
  return {
    async mutate(operation, args) {
      record({ event: "mutate", persona, operation, args }); refuse("mutate");
      return { state: scenario === "write-state" ? "pending" : "sent" };
    },
    async query(operation, args) {
      record({ event: "query", persona, operation, args }); refuse(`${persona}-query`);
      const row = { title: scenario === "read-title" ? "wrong-title" : "Linux consumer proof" };
      return { data: persona === "alice" ? (scenario === "read-count" ? [] : [row])
        : (scenario === "disclosure" ? [row] : []) };
    },
    async close() { record({ event: "close", persona }); },
  };
}
