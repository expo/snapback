import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

const cli = "/Users/ccheever/.local/bin/spacetime";
const arm = "/Users/ccheever/worktrees/llp0102-chat-spacetimedb";
const cwd = `${arm}/work/server/spacetimedb`;
const timings = [];

for (let index = 0; index < 9; index += 1) {
  const started = performance.now();
  const result = spawnSync(
    cli,
    [
      `--root-dir=${arm}/state/cli/root`,
      `--config-path=${arm}/state/cli/cli.toml`,
      "build",
    ],
    { cwd, encoding: "utf8" }
  );
  const elapsedMs = Number((performance.now() - started).toFixed(3));
  timings.push({
    phase: index < 2 ? "warmup" : "recorded",
    sample: index < 2 ? index + 1 : index - 1,
    elapsedMs,
    exitCode: result.status,
    stdoutTail: result.stdout.trim().split("\n").slice(-3),
    stderrTail: result.stderr.trim().split("\n").slice(-3),
  });
  if (result.status !== 0) {
    throw new Error(`build sample ${index} failed with ${result.status}`);
  }
}

await writeFile(
  `${arm}/evidence/performance-build-samples.json`,
  `${JSON.stringify({
    schemaVersion: 1,
    path: "build-or-deploy",
    command: "spacetime build",
    units: "milliseconds",
    warmups: timings.filter(row => row.phase === "warmup"),
    recorded: timings.filter(row => row.phase === "recorded"),
  }, null, 2)}\n`
);
