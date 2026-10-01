import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.016#5 — replay server-produced fault schedules through both actual device hosts.
// scripts/test.sh runs the Rust producer before client tests. For this file alone:
// cargo test -p snapback4-device --test event_slots_trace
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const traces = JSON.parse(readFileSync(join(root, "target/event-slots-traces.json"), "utf8"));
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
for (const tier of ["wasm", "native"]) {
  for (const trace of traces) {
    test(`event slots ${tier}: ${trace.name}`, { timeout: hangBudget(5) }, async t => {
      const dir = mkdtempSync(join(tmpdir(), "sb4-event-slots-"));
      const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir });
      let device = await opener.open("device", trace.backend);
      let capture;
      t.after(async () => { await device.close(); rmSync(dir, { recursive: true, force: true }); });
      for (const [index, step] of trace.calls.entries()) {
        if (step.reopen) {
          await device.close();
          device = await opener.open("device");
        } else {
          const request = structuredClone(step.request);
          // A web reopen fences old in-flight sends. Echo this host's capture,
          // as /sync does, while comparing every row/outbox/publication result.
          if (request.page?.send_revision != null) request.page.send_revision = capture.send_revision;
          const actual = await device.call(request);
          const expected = structuredClone(step.expected);
          if (request.op === "sync_state") {
            capture = structuredClone(actual.ok);
            for (const reply of [actual, expected]) {
              delete reply.ok.send_revision;
              delete reply.ok.adoption_capture["device:send_revision"];
            }
          }
          assert.deepEqual(actual, expected, `step ${index}: ${JSON.stringify(request)}`);
        }
      }
    });
  }
}
