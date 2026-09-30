import test from "node:test";
import assert from "node:assert/strict";
import { launch, root } from "../../../witness/lib.mjs";

test("Chromium SDK reads survive a blocked renderer across the server idle timeout", { timeout: 45_000 }, async t => {
  const f = await launch({ seed: [], extraSource: "query keepalivePing():\n  return 1\n",
    entrySource: `import { createClient } from ${JSON.stringify(root + "/packages/snapback4/src/client.ts")}; window.kaClient = createClient;` });
  t.after(() => f.close());
  const result = await f.page.evaluate(async url => {
    const clients = Array.from({ length: 24 }, () => window.kaClient({ url, persona: "alice" }));
    const rounds = [];
    try {
      for (let round = 0; round < 3; round++) {
        const warm = await Promise.all(clients.map(c => c.query({ name: "media.keepalivePing", kind: "query" }, {})));
        await new Promise(resolve => setTimeout(resolve, 3500));
        const end = performance.now() + 1800; while (performance.now() < end) {}
        const reads = await Promise.all(clients.map(c => c.query({ name: "media.keepalivePing", kind: "query" }, {})));
        rounds.push({ warm: warm.filter(r => r.data === 1).length, success: reads.filter(r => r.data === 1).length, failures: reads.filter(r => r.data !== 1) });
      }
    } finally { await Promise.all(clients.map(c => c.close())); }
    return { userAgent: navigator.userAgent, rounds };
  }, f.api);
  console.log(JSON.stringify(result));
  for (const round of result.rounds) { assert.equal(round.warm, 24); assert.equal(round.success, 24, JSON.stringify(round.failures)); }
});
