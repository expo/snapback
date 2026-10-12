// Production local client + Rust/Wasm device with in-memory durable storage.
// Only the server wire is modeled; no client, outbox or interpreter is stubbed.
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { webDevice, memoryPersistence } from "../../dist/web.js";
// Compile immutable host input before any generated sequence owns virtual time.
const wasm = new WebAssembly.Module(readFileSync(new URL("../../src/wasm/snapback4_device_bg.wasm", import.meta.url)));
export const modelBackend = {
  generation: 1,
  // The viewer probe must actually require a remote fact. A static `runs`
  // class cannot override a known complete local answer (LLP 3000.016 rule 2).
  schema: { tables: { remote: {
    columns: { id: "Id" }, indexes: { byId: { components: [{ Column: "id" }], unique: true } },
    rules: { read: "Allow", insert: "Deny", update: "Deny", delete: "Deny" }, sync: null,
  } }, operations: { viewer: { runs: "server" }, write: { predicts: "never" } } },
  programs: [
    { name: "viewer", kind: "Query", args: {}, body: [{ Return: { Get: {
      table: "remote", index: "byId", key: [{ Literal: { String: "viewer" } }], provenance: "Shape", site: "programs.viewer.0",
    } } }], runs: "server" },
    { name: "write", kind: "Mutation", args: { hiddenHandle: "Bool", refuse: "Bool" }, body: [], predicts: "never" },
  ],
};
export const modelDevice = () => webDevice({ wasm, persist: memoryPersistence() });
let warmed;
export const modelReady = () => warmed ??= (async () => {
  // Compilation is host work, not a generated interleaving. Await it before
  // the first sequence so a cold fixed case cannot skip auth while compiling.
  const core = await modelDevice().open("model-warmup", { initial_backend: modelBackend });
  await core.close();
})();
export const modelPage = (seq, request) => ({ generation: 1, snapshot: !request.stream, events: [], watermark: seq,
  images_at: seq, committed_above: {}, more: false, store_id: "session-model-store" });

// Deterministic retry/backoff time; the model explicitly delivers held replies.
// Date and server expiry remain untouched. Each sequence owns all its timers.
export function modelClock() {
  mock.timers.enable({ apis: ["setTimeout"] });
  return { tick: () => mock.timers.tick(1000), close: () => mock.timers.reset() };
}
