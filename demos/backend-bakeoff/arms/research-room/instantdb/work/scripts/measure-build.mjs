import { spawn } from "node:child_process";
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { evidenceDir, runtimeDir, writeJson, workDir } from "./lib.mjs";

const rawDir = path.join(runtimeDir, "build-logs");
await mkdir(rawDir, { recursive: true, mode: 0o700 });
const samples = [];
for (let i = 0; i < 9; i++) {
  const logPath = path.join(rawDir, `build-${i}.log`);
  const log = await open(logPath, "w", 0o600);
  const start = performance.now();
  const child = spawn("npm", ["run", "build"], { cwd: workDir, stdio: ["ignore", log.fd, log.fd] });
  const exitCode = await new Promise((resolve) => child.on("exit", resolve));
  const elapsedMs = Number((performance.now() - start).toFixed(3));
  await log.close();
  await chmod(logPath, 0o600);
  if (exitCode !== 0) throw new Error(`Build sample ${i} failed; output retained only in ignored runtime.`);
  samples.push(elapsedMs);
}
const recorded = samples.slice(2);
const sorted = [...recorded].sort((a, b) => a - b);
const result = {
  schemaVersion: 1,
  claimScope: "small repeatable product workload; not production scale",
  path: "build-or-deploy",
  commandShape: "npm run build",
  warmups: samples.slice(0, 2),
  samples: recorded,
  medianMs: sorted[Math.floor(sorted.length / 2)],
  nearestRankP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  output: "Vite production client bundle",
  rawLogs: "ignored mode-0600 runtime only",
  containsCredentialValues: false,
};
await writeJson(path.join(evidenceDir, "performance-build-samples.json"), result);
process.stdout.write(JSON.stringify({ ok: true, samples: result.samples.length }) + "\n");
