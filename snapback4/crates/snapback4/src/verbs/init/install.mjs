// API signatures: snapback4 guide api proof | client | auth | generated
// KEEP REGION: foreground by default; explicit --background detaches the owner.
// A private worker group owns npm; IPC EOF stops it even if this owner is killed.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
if (args[0] === "--worker") {
  if (!process.send || !process.connected) throw Error("install worker requires its owning IPC channel");
  const log = openSync(".snapback4/install.log", "a", 0o600);
  const npm = spawn("npm", ["install", "--no-fund", "--no-audit", ...args.slice(1)], { stdio: ["ignore", log, log] });
  closeSync(log);
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
} else if (args.includes("--background")) {
  // No inherited pipe or IPC: tool hosts may kill their entire process group
  // immediately after this command returns. The owner has its own session.
  mkdirSync(".snapback4", { recursive: true, mode: 0o700 });
  const request = randomUUID(), log = openSync(".snapback4/install.log", "a", 0o600);
  // Invalidate an earlier success before the detached owner can be delayed.
  writeFileSync(".snapback4/install-request.json", JSON.stringify({id:request}), {mode:0o600});
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args.filter(a => a !== "--background")], {
    detached: true, stdio: ["ignore", log, log], env: { ...process.env, SNAPBACK4_INSTALL_REQUEST: request },
  });
  closeSync(log);
  let error;
  child.once("error", e => { error = e; });
  child.unref();
  // Join admission only, never npm completion. A receipt must belong to this
  // request, or to a living owner that admitted this duplicate request.
  const until = Date.now() + 5000;
  let admitted = false;
  while (!error && Date.now() < until) {
    try {
      const receipt = JSON.parse(readFileSync(`.snapback4/install-${request}.admitted`, "utf8"));
      if (receipt.request === request) { admitted = true; unlinkSync(`.snapback4/install-${request}.admitted`); break; }
    } catch {}
    await new Promise(r => setTimeout(r, 10));
  }
  if (!admitted) { console.error(`frontend install: owner did not start; ${error?.message ?? "inspect .snapback4/install.log"}`); process.exitCode = 1; }
  else console.log("frontend install: detached; node scripts/install.mjs --status; log .snapback4/install.log");
} else {
  mkdirSync(".snapback4", { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(".snapback4", 0o700);
  const requestFile = ".snapback4/install-request.json";
  const requested = () => { try { return JSON.parse(readFileSync(requestFile,"utf8")).id; } catch { return undefined; } };
  const point = id => writeFileSync(requestFile, JSON.stringify({id}), {mode:0o600});
  const stateFile = ".snapback4/install.json", lockFile = ".snapback4/install.lock";
  mkdirSync(".snapback4/install-runs", {recursive:true,mode:0o700});
  const runPath = id => {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw Error("invalid install request identity");
    return `.snapback4/install-runs/${id}.json`;
  };
  const read = id => {
    try { if (id) return JSON.parse(readFileSync(runPath(id), "utf8")); } catch {}
    try { const s=JSON.parse(readFileSync(stateFile, "utf8")); return !id || s.request === id ? s : null; } catch { return null; }
  };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };
  const report = s => console.log(s ? `frontend install: ${s.state}; ${Math.round((Date.now() - s.started) / 1000)}s elapsed${s.code === undefined ? "" : `; exit ${s.code}`}; log .snapback4/install.log` : "frontend install: not started; node scripts/install.mjs");
  const wait = async (target = requested()) => {
    const pendingSince = Date.now();
    if (!target) { report(null); return 1; }
    for (;;) {
      // Pin this join. A later launch cannot replace its failure with success.
      let s = read(target), seen = new Set([target]);
      while (s?.ownerRequest) {
        if (seen.has(s.ownerRequest)) throw Error("install join identity cycle");
        seen.add(s.ownerRequest); s=read(s.ownerRequest);
      }
      if (!s) {
        if (Date.now() - pendingSince > 30_000) { console.error("frontend install: requested owner did not start within 30s; inspect .snapback4/install.log"); return 1; }
        await new Promise(resolve => setTimeout(resolve, 100)); continue;
      }
      if (s.state !== "running" || !alive(s.pid)) { report(s); return s.state === "finished" ? s.code : 1; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  };
  if (args.includes("--status")) { if (requested() && read()?.request !== requested()) console.log("frontend install: requested run starting; earlier receipt is not this run"); else report(read()); }
  else if (args.includes("--wait")) process.exitCode = await wait();
  else {
    const request = process.env.SNAPBACK4_INSTALL_REQUEST ?? randomUUID();
    point(request);
    const admit = () => {
      if (process.env.SNAPBACK4_INSTALL_REQUEST) writeFileSync(`.snapback4/install-${request}.admitted`, JSON.stringify({request}), {mode:0o600});
    };
    let locked = false;
    try { const fd = openSync(lockFile, "wx", 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd); locked = true; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      let pid; try { pid = Number(readFileSync(lockFile, "utf8")); } catch {}
      if (pid > 0 && alive(pid)) {
        const until = Date.now() + 3000;
        while ((read()?.pid !== pid || !read()?.request) && Date.now() < until) await new Promise(r => setTimeout(r, 10));
        const running = read();
        if (running?.pid === pid && running.request) {
          if (request !== running.request) writeFileSync(runPath(request), JSON.stringify({request, ownerRequest:running.request}), {mode:0o600});
          point(running.request); admit();
        }
        process.exitCode = args.includes("--background") ? 0 : await wait(request);
      }
      else { unlinkSync(lockFile); console.error("frontend install: stale owner removed; rerun node scripts/install.mjs"); process.exitCode = 1; }
    }
    if (locked) {
      const started = Date.now(), state = { state: "running", request, pid: process.pid, started };
      const save = extra => {
        const text=JSON.stringify({ ...state, ...extra }) + "\n";
        writeFileSync(runPath(request), text, {mode:0o600});
        writeFileSync(stateFile, text, {mode:0o600});
      };
      save({}); admit(); console.error("frontend install: running; read `npx snapback4 guide start` or edit snapback/schema.q meanwhile. Wait once with `node scripts/install.mjs --wait` (allow the command to finish).");
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--worker", ...args.filter(a => a !== "--background")], { detached: process.platform !== "win32", stdio: ["ignore", "inherit", "inherit", "ipc"] });
      let result = 1, done = false;
      const finish = () => {
        if (done) return; done = true;
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
