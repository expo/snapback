#!/usr/bin/env node
// `npx snapback4 <verb>`: the Rust binary, found in the platform package
// installed beside this one, or named by SNAPBACK4_BIN, or built in this
// repository. The JavaScript here only finds and runs it, and dies with it:
// a signal to this wrapper reaches the binary, so a recorded PID of either
// stops the server.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const platform = `snapback4-${process.platform}-${process.arch}`;
const candidates = [];
if (process.env.SNAPBACK4_BIN) candidates.push(resolve(process.env.SNAPBACK4_BIN));
try { candidates.push(join(dirname(require.resolve(`${platform}/package.json`)), "snapback4")); } catch { /* not installed for this platform */ }
candidates.push(resolve(here, "../../../target/release/snapback4"), resolve(here, "../../../target/debug/snapback4"));
const binary = candidates.find((path) => existsSync(path));
if (!binary) {
  console.error(`snapback4: no binary for ${process.platform}-${process.arch}. Packages exist for darwin-arm64; elsewhere, build with \`cargo build --release -p snapback4\` and set SNAPBACK4_BIN.`);
  process.exit(2);
}
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
child.on("exit", (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
