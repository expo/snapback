import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const environment = () => ({ ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  npm_config_cache: process.env.npm_config_cache ?? join(tmpdir(), "snapback4-ceremony-npm-cache"), SNAPBACK4_BIN: undefined, CI: undefined });
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function launch(command, args, { cwd, log, input, env = {}, limitMs } = {}) {
  const child = spawn(command, args, { cwd, env: { ...environment(), ...env }, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const sink = log ? createWriteStream(log) : null;
  let output = "", stdout = "", timedOut = false, launchError = null;
  const collect = (data) => { output = (output + data).slice(-100_000); sink?.write(data); };
  child.stdout.on("data", (data) => { stdout = (stdout + data).slice(-100_000); collect(data); }); child.stderr.on("data", collect);
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  // The process group is created here and owned by this invocation. Never find
  // another process by port, command, directory or name to clean up a run.
  const signal = (name) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  let killTimer;
  const timer = limitMs ? setTimeout(() => {
    timedOut = true; signal("SIGTERM"); killTimer = setTimeout(() => signal("SIGKILL"), 3000);
  }, limitMs) : null;
  const done = new Promise((resolve) => {
    child.on("error", (error) => { launchError = error.message; });
    child.on("close", (status, exitSignal) => {
      clearTimeout(timer); clearTimeout(killTimer);
      const result = { status, signal: exitSignal, timedOut, error: launchError, out: output, stdout, pid: child.pid ?? null };
      if (sink) sink.end(() => resolve(result)); else resolve(result);
    });
  });
  return { child, done, get output() { return output; }, async stop() {
    signal("SIGTERM");
    const force = setTimeout(() => signal("SIGKILL"), 3000);
    try { return await done; } finally { clearTimeout(force); }
  } };
}

export async function command(command, args, options = {}) {
  return launch(command, args, { limitMs: 300_000, ...options }).done;
}

export async function freePort() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 49501 + Math.floor(Math.random() * 14000);
    const server = createServer();
    const bound = await new Promise((resolve) => { server.once("error", () => resolve(false)); server.listen(port, "127.0.0.1", () => resolve(true)); });
    if (bound) { await new Promise((resolve) => server.close(resolve)); return port; }
  }
  throw new Error("could not reserve a free loopback port above 49500");
}
