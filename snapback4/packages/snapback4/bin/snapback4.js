#!/usr/bin/env node
// `npx snapback4 <verb>`: the Rust binary, found in the platform package
// installed beside this one, or named by SNAPBACK4_BIN, or built in this
// repository. The JavaScript here only finds and runs it, and dies with it:
// a signal to this wrapper reaches the binary, so a recorded PID of either
// stops the server.
import { spawn } from "node:child_process";
import { resolveBinary } from "../dist/resolve-binary.js";

if (process.argv[2] === "web-shell") {
  try { await (await import("./web-shell.js")).runWebShell(process.argv.slice(3)); }
  catch (error) { console.error(error.message); process.exit(2); }
  process.exit(0);
}

let binary;
try { binary = resolveBinary(); }
catch (error) { console.error(error.message); process.exit(2); }
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => { try { child.kill(signal); } catch { /* gone */ } });
child.on("exit", (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exit(code ?? 1);
});
