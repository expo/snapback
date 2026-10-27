// API signatures: snapback4 guide api proof | client | auth | generated
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync } from "node:fs";
mkdirSync(".snapback4", { recursive: true, mode: 0o700 });
const stateFile = ".snapback4/install.json", lockFile = ".snapback4/install.lock";
const read = () => { try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const report = s => console.log(s ? `frontend install: ${s.state}; ${Math.round((Date.now() - s.started) / 1000)}s elapsed${s.code === undefined ? "" : `; exit ${s.code}`}; log .snapback4/install.log` : "frontend install: not started; node scripts/install.mjs");
const wait = async () => {
  let tick = 0;
  for (;;) {
    const s = read();
    if (!s || s.state !== "running" || !alive(s.pid)) { report(s); return s?.state === "finished" ? s.code : 1; }
    if (tick++ % 10 === 0) report(s);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
};
const args = process.argv.slice(2);
if (args.includes("--status")) report(read());
else if (args.includes("--wait")) process.exitCode = await wait();
else {
  let locked = false;
  try { const fd = openSync(lockFile, "wx", 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); locked = true; }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    let pid; try { pid = Number(readFileSync(lockFile, "utf8")); } catch {}
    if (pid > 0 && alive(pid)) process.exitCode = args.includes("--background") ? 0 : await wait();
    else { unlinkSync(lockFile); console.error("frontend install: stale owner removed; rerun node scripts/install.mjs"); process.exitCode = 1; }
  }
  if (locked) {
    const started = Date.now(), state = { state: "running", pid: process.pid, started };
    const save = extra => writeFileSync(stateFile, JSON.stringify({ ...state, ...extra }) + "\n", { mode: 0o600 });
    save({}); console.error("Installing frontend dependencies with npm; you can edit the schema now.");
    const child = spawn("npm", ["install", ...args.filter(a => a !== "--background")], { stdio: ["ignore", "inherit", "inherit"] });
    const progress = setInterval(() => console.error(`npm install still running (${Math.round((Date.now() - started) / 1000)}s elapsed)`), 10_000);
    let done = false;
    const finish = (code, signal) => {
      if (done) return; done = true; clearInterval(progress);
      save({ state: "finished", code, ...(signal ? { signal } : {}) });
      unlinkSync(lockFile); console.error(`npm install finished (exit ${code})`); process.exitCode = code;
    };
    child.once("error", error => { console.error(`npm install could not start: ${error.message}`); finish(1); });
    child.once("exit", (code, signal) => finish(code ?? 1, signal));
    for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
  }
}
