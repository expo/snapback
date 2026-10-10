#!/usr/bin/env node
// `npx snapback4 <verb>`: the Rust binary, found in the platform package
// installed beside this one, or named by SNAPBACK4_BIN, or built in this
// repository. The JavaScript here only finds and runs it, and dies with it:
// a signal to this wrapper reaches the binary, so a recorded PID of either
// stops the server.
import { spawn } from "node:child_process";
import { resolveBinary } from "../dist/resolve-binary.js";
import { fileURLToPath } from "node:url";
import { constants } from "node:os";

if (process.argv[2] === "web-shell") {
  try { await (await import("./web-shell.js")).runWebShell(process.argv.slice(3)); }
  catch (error) { console.error(`E_INPUT at web-shell: ${error.message}\n  rewrite: export a static app, then run snapback4 web-shell dist --base /`); process.exit(2); }
  process.exit(0);
}

let binary;
try { binary = resolveBinary(); }
catch (error) { console.error(error.message); process.exit(2); }
// Internal export helpers share the wrapper's kernel lease through fd 3.
const exportLease = process.argv[2] === "witness" && ["export-lease", "export-publish"].includes(process.argv[3]);
const child = spawn(binary, process.argv.slice(2), { stdio: exportLease ? ["inherit", "inherit", "inherit", 3] : "inherit", env: {
  ...process.env, SNAPBACK4_ACQUIRE_HELPER: fileURLToPath(new URL("./witness-acquire.js", import.meta.url)),
} });
const handlers = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map(signal => [signal, () => { try { child.kill(signal); } catch { /* gone */ } }]));
for (const [signal, handler] of handlers) process.on(signal, handler);
// `npx snapback4 dev` puts npm and `sh -c` above this wrapper. A SIGTERM to the
// npx PID kills npm and the shell but never reaches us, so the server would keep
// serving as an orphan. Our parent's death is the stop signal. (`process.ppid` is
// read once at startup, so probe the original parent instead.)
const parent = process.ppid;
const parentAlive = () => { try { process.kill(parent, 0); return true; } catch (error) { return error.code === "EPERM"; } };
const orphanWatch = parent > 1 ? setInterval(() => {
  if (!parentAlive()) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}, 250) : null;
orphanWatch?.unref();
child.on("exit", (code, signal) => {
  if (orphanWatch) clearInterval(orphanWatch);
  for (const [name, handler] of handlers) process.off(name, handler);
  if (signal) {
    // Restore the default disposition before re-raising. Some platforms do not
    // terminate on this call; never let their empty event loop report success.
    const status = 128 + (constants.signals[signal] ?? { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal] ?? 1);
    setTimeout(() => process.exit(status), 100);
    try { process.kill(process.pid, signal); } catch { process.exit(status); }
    return;
  }
  process.exit(code ?? 1);
});
