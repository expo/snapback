import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const startupBudgetMs = 30_000;
const stopBudgetMs = 10_000;
const commandBudgetMs = 60_000;
const controlBudgetMs = 5_000;
const terminateGraceMs = 5_000;

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
    const finish = (callback, value) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      callback(value);
    };
    const onExit = () => finish(resolve);
    const onError = (error) => finish(reject, error);
    const timer = setTimeout(() => finish(reject, new Error(`${label} did not exit within ${timeoutMs} ms`)), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function waitStreams(child) {
  const drained = Promise.all([child.stdout, child.stderr].map((stream) => {
    if (stream.closed || stream.readableEnded) return Promise.resolve();
    return new Promise((resolve) => {
      stream.once("end", resolve);
      stream.once("close", resolve);
    });
  })).then(() => true);
  let timer;
  const completed = await Promise.race([
    drained,
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), terminateGraceMs); }),
  ]);
  clearTimeout(timer);
  return completed;
}

async function terminateOwned(child, label) {
  const signals = [];
  if (child.exitCode === null && child.signalCode === null) {
    signals.push("SIGTERM");
    child.kill("SIGTERM");
    try { await waitExit(child, terminateGraceMs, `${label} SIGTERM`); } catch { /* escalate exact PID */ }
  }
  if (child.exitCode === null && child.signalCode === null) {
    signals.push("SIGKILL");
    child.kill("SIGKILL");
    await waitExit(child, terminateGraceMs, `${label} SIGKILL`);
  }
  return signals;
}

async function boundedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), controlBudgetMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

export async function capturedCommand({ command, args, cwd, env, label, pids }) {
  const stdoutPath = join(cwd, ".snapback", `${label}.stdout`);
  const stderrPath = join(cwd, ".snapback", `${label}.stderr`);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const pidReceipt = { kind: "preflight", label, pid: child.pid, command: [command, ...args],
    budgetMs: commandBudgetMs, forcedSignals: [] };
  pids.push(pidReceipt);
  process.stdout.write(`${JSON.stringify({ event: "launched", kind: "preflight", label, pid: child.pid })}\n`);
  const stdout = [], stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let timer;
  const outcome = await Promise.race([
    exited,
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), commandBudgetMs); }),
  ]);
  clearTimeout(timer);
  if (outcome.timedOut) {
    pidReceipt.forcedSignals = await terminateOwned(child, label);
    pidReceipt.streamsDrained = await waitStreams(child);
  } else {
    pidReceipt.streamsDrained = true;
  }
  pidReceipt.exitCode = child.exitCode;
  pidReceipt.signalCode = child.signalCode;
  pidReceipt.timedOut = outcome.timedOut === true;
  const stdoutBytes = Buffer.concat(stdout), stderrBytes = Buffer.concat(stderr);
  await Promise.all([writeFile(stdoutPath, stdoutBytes), writeFile(stderrPath, stderrBytes)]);
  if (outcome.error) fail(`${label} failed to launch`, String(outcome.error));
  if (outcome.timedOut || child.exitCode !== 0) fail(`${label} ${outcome.timedOut ? "timed out" : `exited ${child.exitCode}`}`, {
    stdout: stdoutBytes.toString().slice(-4000), stderr: stderrBytes.toString().slice(-4000),
  });
  return { exitCode: child.exitCode, pid: child.pid, budgetMs: commandBudgetMs,
    stdout: await identity(stdoutPath), stderr: await identity(stderrPath) };
}

async function startOwner(options) {
  const stdoutPath = join(options.variant.root, ".snapback", `${options.variant.label}-owner.stdout`);
  const stderrPath = join(options.variant.root, ".snapback", `${options.variant.label}-owner.stderr`);
  const child = spawn(options.binary, ["dev", "--foreground", "--port", "0"], {
    cwd: options.variant.root, env: { ...process.env, SNAPBACK2_COMPILER: options.compiler },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const pidReceipt = { kind: "owner", label: options.variant.label, pid: child.pid,
    command: [options.binary, "dev", "--foreground", "--port", "0"],
    startupBudgetMs, stopBudgetMs, forcedSignals: [] };
  options.pids.push(pidReceipt);
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
    pidReceipt.state = "running";
    return { child, raw, stdout, stderr, stdoutPath, stderrPath, pidReceipt };
  } catch (error) {
    pidReceipt.forcedSignals = await terminateOwned(child, "failed-start owned owner");
    await waitStreams(child);
    pidReceipt.exitCode = child.exitCode;
    pidReceipt.signalCode = child.signalCode;
    pidReceipt.state = "failed-start-cleaned";
    await Promise.all([writeFile(stdoutPath, Buffer.concat(stdout)), writeFile(stderrPath, Buffer.concat(stderr))]);
    throw error;
  }
}

async function stopOwner(handle) {
  let forcedSignals = [];
  let streamsDrained = false;
  try {
    const response = await boundedFetch(`${handle.raw.url}/control/stop`, { method: "POST",
      headers: { "content-type": "application/json", "x-snapback-control": handle.raw.secret },
      body: JSON.stringify({ cause: "follower-scale proof complete" }) });
    if (!response.ok) fail(`owner stop returned ${response.status}`, await response.text());
    await waitExit(handle.child, stopBudgetMs, "owned owner");
  } catch (error) {
    forcedSignals = await terminateOwned(handle.child, "stop-owned owner");
    if (forcedSignals.length === 0) throw error;
  } finally {
    streamsDrained = await waitStreams(handle.child);
    await Promise.all([
      writeFile(handle.stdoutPath, Buffer.concat(handle.stdout)),
      writeFile(handle.stderrPath, Buffer.concat(handle.stderr)),
    ]);
    handle.pidReceipt.forcedSignals = forcedSignals;
    handle.pidReceipt.exitCode = handle.child.exitCode;
    handle.pidReceipt.signalCode = handle.child.signalCode;
    handle.pidReceipt.state = "exited";
  }
  return { exitCode: handle.child.exitCode, signalCode: handle.child.signalCode, forcedSignals,
    controlBudgetMs, streamsDrained,
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
    harnessBudgets: { startupMs: startupBudgetMs, stopMs: stopBudgetMs,
      commandMs: commandBudgetMs, controlMs: controlBudgetMs } };
}
