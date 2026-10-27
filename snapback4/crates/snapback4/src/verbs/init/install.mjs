// API signatures: snapback4 guide api proof | client | auth | generated
// A private worker group owns npm; IPC EOF stops it even if this owner is killed.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args[0] === "--worker") {
  if (!process.send || !process.connected) throw Error("install worker requires its owning IPC channel");
  const npm = spawn("npm", ["install", ...args.slice(1)], { stdio: ["ignore", "inherit", "inherit"] });
  const stop = () => {
    if (process.platform === "win32") { npm.kill("SIGKILL"); process.exit(1); }
    // The owner spawned THIS process as its private group leader. Never read a
    // persisted PID/group to authorize a signal.
    process.kill(-process.pid, "SIGKILL");
  };
  process.once("disconnect", stop); process.once("message", stop);
  npm.once("error", error => { console.error(`npm install could not start: ${error.message}`); process.send?.({code:1}); });
  npm.once("exit", (code, signal) => { process.send?.({code:code ?? 1, signal}); });
  // Remain group leader until the owner closes IPC, reclaiming descendants too.
} else {
  mkdirSync(".snapback4", { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(".snapback4", 0o700);
  const requestFile = ".snapback4/install-request.json";
  const requested = () => { try { return JSON.parse(readFileSync(requestFile,"utf8")).id; } catch { return undefined; } };
  const point = id => writeFileSync(requestFile, JSON.stringify({id}), {mode:0o600});
  const stateFile = ".snapback4/install.json", lockFile = ".snapback4/install.lock";
  const read = () => { try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; } };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
  const report = s => console.log(s ? `frontend install: ${s.state}; ${Math.round((Date.now() - s.started) / 1000)}s elapsed${s.code === undefined ? "" : `; exit ${s.code}`}; log .snapback4/install.log` : "frontend install: not started; node scripts/install.mjs");
  const wait = async () => {
    let tick = 0, pendingSince = Date.now();
    for (;;) {
      const s = read();
      if (requested() && s?.request !== requested()) {
        if (Date.now() - pendingSince > 30_000) { console.error("frontend install: requested owner did not start within 30s; inspect .snapback4/install.log"); return 1; }
        if (tick++ % 10 === 0) console.log("frontend install: requested run starting; earlier receipt is not this run");
        await new Promise(resolve => setTimeout(resolve, 100)); continue;
      }
      if (!s || s.state !== "running" || !alive(s.pid)) { report(s); return s?.state === "finished" ? s.code : 1; }
      if (tick++ % 10 === 0) report(s);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };
  if (args.includes("--status")) { if (requested() && read()?.request !== requested()) console.log("frontend install: requested run starting; earlier receipt is not this run"); else report(read()); }
  else if (args.includes("--wait")) process.exitCode = await wait();
  else {
    const request = process.env.SNAPBACK4_INSTALL_REQUEST ?? randomUUID();
    point(request);
    let locked = false;
    try { const fd = openSync(lockFile, "wx", 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); locked = true; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid; try { pid = Number(readFileSync(lockFile, "utf8")); } catch {}
      if (pid > 0 && alive(pid)) {
        const until = Date.now() + 3000;
        while ((read()?.pid !== pid || !read()?.request) && Date.now() < until) await new Promise(r => setTimeout(r, 10));
        const running = read();
        if (running?.pid === pid && running.request) point(running.request);
        process.exitCode = args.includes("--background") ? 0 : await wait();
      }
      else { unlinkSync(lockFile); console.error("frontend install: stale owner removed; rerun node scripts/install.mjs"); process.exitCode = 1; }
    }
    if (locked) {
      const started = Date.now(), state = { state: "running", request, pid: process.pid, started };
      const save = extra => writeFileSync(stateFile, JSON.stringify({ ...state, ...extra }) + "\n", { mode: 0o600 });
      save({}); console.error("Installing dependencies with npm (frontend); you can edit the schema now.");
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", ...args.filter(a => a !== "--background")], { detached: process.platform !== "win32", stdio: ["ignore", "inherit", "inherit", "ipc"] });
      const progress = setInterval(() => console.error(`npm install still running (${Math.round((Date.now() - started) / 1000)}s elapsed)`), 10_000);
      let result = 1, done = false;
      const finish = () => {
        if (done) return; done = true; clearInterval(progress);
        save({ state: "finished", code: result }); unlinkSync(lockFile);
        console.error(`npm install finished (exit ${result})`); process.exitCode = result;
      };
      child.once("message", message => { if (Number.isInteger(message?.code)) result = message.code; child.disconnect(); });
      child.once("error", error => { console.error(`npm install could not start: ${error.message}`); finish(); });
      child.once("exit", finish);
      for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { result = 1; if (child.connected) child.disconnect(); });
    }
  }
}
