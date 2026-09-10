import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const startupBudgetMs = 30_000;
const stopBudgetMs = 10_000;

function fail(message, value) {
  throw new Error(value === undefined ? message : `${message}: ${JSON.stringify(value)}`);
}

async function identity(path) {
  const bytes = await readFile(path);
  return { path, bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

function waitExit(child, timeoutMs, label) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} did not exit within ${timeoutMs} ms`)), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

export async function capturedCommand({ command, args, cwd, env, label, pids }) {
  const stdoutPath = join(cwd, ".snapback", `${label}.stdout`);
  const stderrPath = join(cwd, ".snapback", `${label}.stderr`);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  pids.push({ kind: "preflight", label, pid: child.pid, command: [command, ...args] });
  process.stdout.write(`${JSON.stringify({ event: "launched", kind: "preflight", label, pid: child.pid })}\n`);
  const stdout = [], stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => signal ? reject(new Error(`${label} ended by ${signal}`)) : resolve(code));
  });
  const stdoutBytes = Buffer.concat(stdout), stderrBytes = Buffer.concat(stderr);
  await Promise.all([writeFile(stdoutPath, stdoutBytes), writeFile(stderrPath, stderrBytes)]);
  if (exitCode !== 0) fail(`${label} exited ${exitCode}`, {
    stdout: stdoutBytes.toString().slice(-4000), stderr: stderrBytes.toString().slice(-4000),
  });
  return { exitCode, pid: child.pid, stdout: await identity(stdoutPath), stderr: await identity(stderrPath) };
}

async function startOwner(options) {
  const stdoutPath = join(options.variant.root, ".snapback", `${options.variant.label}-owner.stdout`);
  const stderrPath = join(options.variant.root, ".snapback", `${options.variant.label}-owner.stderr`);
  const child = spawn(options.binary, ["dev", "--foreground", "--port", "0"], {
    cwd: options.variant.root, env: { ...process.env, SNAPBACK2_COMPILER: options.compiler },
    stdio: ["ignore", "pipe", "pipe"],
  });
  options.pids.push({ kind: "owner", label: options.variant.label, pid: child.pid,
    command: [options.binary, "dev", "--foreground", "--port", "0"] });
  process.stdout.write(`${JSON.stringify({ event: "launched", kind: "owner", label: options.variant.label, pid: child.pid })}\n`);
  const stdout = [], stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  let timer;
  try {
    const ready = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${options.variant.label} owner readiness exceeded ${startupBudgetMs} ms`)), startupBudgetMs);
      lines.once("line", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`${options.variant.label} owner exited ${code} before readiness`)));
    }).finally(() => { clearTimeout(timer); lines.close(); });
    if (!/^SNAPBACK_URL=http:\/\/127\.0\.0\.1:\d+$/u.test(ready)) fail("owner readiness line differed", ready);
    const raw = JSON.parse(await readFile(join(options.variant.root, ".snapback", "owner.json"), "utf8"));
    if (raw.generation !== options.generation || raw.pid !== child.pid || raw.url !== ready.slice("SNAPBACK_URL=".length)) {
      fail("owner identity differed", { expectedGeneration: options.generation, pid: child.pid,
        actual: { generation: raw.generation, pid: raw.pid, url: raw.url } });
    }
    return { child, raw, stdout, stderr, stdoutPath, stderrPath };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await waitExit(child, stopBudgetMs, "failed-start owned owner");
    }
    await Promise.all([writeFile(stdoutPath, Buffer.concat(stdout)), writeFile(stderrPath, Buffer.concat(stderr))]);
    throw error;
  }
}

async function stopOwner(handle) {
  let forcedSignal = null;
  try {
    const response = await fetch(`${handle.raw.url}/control/stop`, { method: "POST",
      headers: { "content-type": "application/json", "x-snapback-control": handle.raw.secret },
      body: JSON.stringify({ cause: "follower-scale proof complete" }) });
    if (!response.ok) fail(`owner stop returned ${response.status}`, await response.text());
    await waitExit(handle.child, stopBudgetMs, "owned owner");
  } catch (error) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      forcedSignal = "SIGTERM";
      handle.child.kill(forcedSignal);
      await waitExit(handle.child, stopBudgetMs, "SIGTERM-owned owner");
    }
    if (forcedSignal === null) throw error;
  } finally {
    await Promise.all([
      writeFile(handle.stdoutPath, Buffer.concat(handle.stdout)),
      writeFile(handle.stderrPath, Buffer.concat(handle.stderr)),
    ]);
  }
  return { exitCode: handle.child.exitCode, signalCode: handle.child.signalCode, forcedSignal,
    stdout: await identity(handle.stdoutPath), stderr: await identity(handle.stderrPath) };
}

export async function withOwnedOwner(options, body) {
  const handle = await startOwner(options);
  let value, bodyError;
  try { value = await body(handle.raw); } catch (error) { bodyError = error; }
  let processReceipt;
  try { processReceipt = await stopOwner(handle); } catch (error) { if (!bodyError) bodyError = error; }
  if (bodyError) throw bodyError;
  const { secret: _secret, ...owner } = handle.raw;
  return { value, owner, process: processReceipt,
    harnessBudgets: { startupMs: startupBudgetMs, stopMs: stopBudgetMs } };
}
