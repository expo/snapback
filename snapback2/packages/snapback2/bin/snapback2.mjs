#!/usr/bin/env node
// Resolve the platform binary package and exec it. No other logic lives here.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const name = `snapback2-${process.platform}-${process.arch}`;
let bin;
try {
  bin = createRequire(import.meta.url).resolve(`${name}/bin/snapback2`);
} catch {
  console.error(`snapback2: no binary package for ${process.platform}-${process.arch} (${name} is not installed)`);
  process.exit(2);
}
const env = {
  ...process.env,
  SNAPBACK2_NODE: process.execPath,
  SNAPBACK2_COMPILER: fileURLToPath(new URL("../dist/compiler.mjs", import.meta.url)),
  SNAPBACK2_GUIDE: fileURLToPath(new URL("../dist/guide", import.meta.url)),
  SNAPBACK2_TEMPLATES: fileURLToPath(new URL("../dist/templates", import.meta.url)),
  SNAPBACK2_TEST_RUNNER: fileURLToPath(new URL("../dist/test-runner.mjs", import.meta.url)),
};
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit", env });
if (result.error) {
  console.error(`snapback2: failed to spawn ${bin}: ${result.error.message}`);
  process.exit(1);
}
if (result.signal) {
  try {
    process.kill(process.pid, result.signal);
  } catch (error) {
    console.error(`snapback2: ${bin} terminated by ${result.signal}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
if (typeof result.status === "number") process.exit(result.status);
console.error(`snapback2: ${bin} exited without a status or signal`);
process.exit(1);
