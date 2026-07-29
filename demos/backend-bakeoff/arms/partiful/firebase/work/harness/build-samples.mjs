import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const armRoot = new URL("../../", import.meta.url);
const outputPath = new URL("evidence/party-14-build-samples.json", armRoot);
const samplesMs = [];
for (let iteration = 0; iteration < 9; iteration += 1) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [
    new URL("../node_modules/vite/bin/vite.js", import.meta.url).pathname,
    "build",
  ], {
    cwd: new URL("../", import.meta.url),
    env: process.env,
    encoding: "utf8",
  });
  const elapsed = performance.now() - started;
  if (result.status !== 0) {
    throw new Error(`build sample ${iteration + 1} failed: ${result.stderr}`);
  }
  samplesMs.push(Number(elapsed.toFixed(3)));
}
const ordered = [...samplesMs].sort((a, b) => a - b);
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  scenario: "PARTY-14-PERFORMANCE",
  path: "build-or-deploy",
  command: "vite build",
  environment: "local production UI build; no hosted deploy claim",
  samplesMs,
  medianMs: ordered[4],
  p95ObservedMs: ordered[8],
  sampleCount: 9,
  builtFiles: (await readFile(new URL("../dist/index.html", import.meta.url), "utf8")).length > 0,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: true, samples: samplesMs.length })}\n`);
