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
  SNAPBACK2_COMPILER: fileURLToPath(new URL("../dist/compiler.mjs", import.meta.url)),
};
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit", env });
process.exit(result.status ?? 1);
