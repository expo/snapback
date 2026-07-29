import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";

function runBuild() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn("./node_modules/.bin/vite", ["build"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(performance.now() - started);
      else reject(new Error(`VITE_BUILD_${code}:${error.slice(0, 500)}`));
    });
  });
}

const samples = [];
for (let index = 0; index < 9; index += 1) samples.push(await runBuild());
const recorded = samples.slice(2);
const sorted = [...recorded].sort((a, b) => a - b);
const evidence = {
  name: "build-or-deploy",
  path: "Vite production build",
  warmupsMs: samples.slice(0, 2).map((value) => Number(value.toFixed(3))),
  recorded: {
    rawMs: recorded.map((value) => Number(value.toFixed(3))),
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    nearestRankP95Ms: Number(sorted[Math.ceil(0.95 * sorted.length) - 1].toFixed(3)),
  },
};
await mkdir("evidence", { recursive: true });
await writeFile("evidence/performance.build.json", JSON.stringify(evidence, null, 2) + "\n");
