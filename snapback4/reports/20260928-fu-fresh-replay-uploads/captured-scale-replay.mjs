#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readdirSync, readlinkSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { replayFile } from "./replay-adapter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.SCALE_PORT ?? 56402);
const url = `http://127.0.0.1:${port}`;
const manifest = JSON.parse(await readFile(resolve(root, "fixtures/invariant-manifest-combined.json"), "utf8"));
const scalePath = resolve(root, "fixtures/scale.log");
const logSha = createHash("sha256").update(await readFile(scalePath)).digest("hex");
const expectedSha = manifest.artifacts["scale.log"].sha256;
if (logSha !== expectedSha) {
  throw new Error(`scale.log sha mismatch got ${logSha} expected ${expectedSha}`);
}

const startedAt = new Date();
const startedEpoch = Math.floor(Date.now() / 1000);
process.env.SNAPBACK_URL = url;
process.env.SNAPBACK_REPLAY_WAIT = process.env.SNAPBACK_REPLAY_WAIT ?? "0";
process.env.SNAPBACK_REPLAY_ADMIT_PENDING = process.env.SNAPBACK_REPLAY_ADMIT_PENDING ?? "1";

const child = spawn(process.env.FU_BIN ?? resolve(root, "node_modules/snapback4-linux-x64/snapback4"), ["dev", "--port", String(port), "--bind", "127.0.0.1", "--no-watch", "--fresh", "--replay"], {
  cwd: root,
  env: { ...process.env, PATH: process.env.PATH },
  stdio: ["ignore", "pipe", "pipe"],
});
const evidence = process.env.FU_EVIDENCE;
await writeFile(`${evidence}/server-limits.txt`, await readFile(`/proc/${child.pid}/limits`));
const out = createWriteStream(`${evidence}/server.stdout`);
const err = createWriteStream(`${evidence}/server.stderr`);
child.stdout.pipe(out); child.stderr.pipe(err);
let serverExit = null;
const exited = new Promise(resolve => child.on("exit", (code, signal) => { serverExit = { code, signal }; resolve(serverExit); }));
const fdLog = createWriteStream(`${evidence}/server-fds.jsonl`);
const monitor = setInterval(() => {
  try {
    const fds = readdirSync(`/proc/${child.pid}/fd`).map(n => { try { return readlinkSync(`/proc/${child.pid}/fd/${n}`); } catch { return "closed"; } });
    fdLog.write(JSON.stringify({ time: new Date().toISOString(), pid: child.pid, count: fds.length, sockets: fds.filter(x=>x.startsWith("socket:")).length }) + "\n");
  } catch {}
}, 500);
let ready = false;
child.stdout.on("data", (buf) => {
  const text = buf.toString();
  if (text.includes("http://")) ready = true;
  process.stdout.write(text);
});
child.stderr.on("data", (buf) => process.stderr.write(buf));

const deadline = Date.now() + 60000;
while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
if (!ready) {
  child.kill("SIGTERM");
  throw new Error("scale backend did not start");
}

const sessions = new Map();
const checkpoints = [];
let failedActions = 0;
let settledPrefix = 0;
let pass = false;
let error = null;
try {
  for (const name of ["starter-m1.log", "starter-m2.log", "starter-m3.log"]) {
    const seeded = await replayFile(resolve(root, "fixtures", name), { url, sessions });
    console.log(`scale seed ${name}: ${seeded.actions}`);
  }
  const result = await replayFile(scalePath, {
    url,
    sessions,
    onCheckpoint: async (line, n) => {
      settledPrefix = n;
      const id = line.includes("10%") ? "10%" : line.includes("50%") ? "50%" : line;
      const meta = manifest.checkpoints[id];
      const prefixLen = meta?.scaleLinesConsumedIncludingMarker ?? n;
      const prefix = await readPrefix(scalePath, prefixLen);
      const sha = createHash("sha256").update(prefix).digest("hex");
      checkpoints.push({
        id,
        settledPrefix: n,
        prefixSha256: `sha256:${sha}`,
      });
      console.log(`scale checkpoint ${id} actions=${n} sha=${sha}`);
    },
  });
  settledPrefix = result.actions;
  pass = true;
  console.log(`scale replay settled ${result.actions}`);
} catch (err) {
  error = String(err);
  failedActions = 1;
  console.error("scale replay failed", err);
}

const finishedAt = new Date();
const finishedEpoch = Math.floor(Date.now() / 1000);
const receipt = {
  version: "snapback.full-journey-scale-replay-receipt.v1",
  pass,
  actionLog: {
    sha256: `sha256:${logSha}`,
    actionCount: manifest.artifacts["scale.log"].actionCount,
  },
  settledPrefix,
  failedActions,
  checkpoints: checkpoints.map((c) => ({
    id: c.id,
    settledPrefix: c.settledPrefix,
    prefixSha256: c.prefixSha256,
  })),
  error,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  startedEpoch,
  finishedEpoch,
  backendPid: child.pid,
  url,
};
await mkdir(resolve(root, "artifacts"), { recursive: true });
const receiptPath = resolve(root, "artifacts/scale-replay-receipt.json");
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
const replayEvidence = {
  version: "snapback.full-journey-scale-replay.v1",
  attempted: true,
  capSeconds: 14400,
  probeWallSecondsExcluded: 0,
  attempts: [{
    attempt: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    settledPrefix,
    disposition: pass ? "completed" : "aborted",
  }],
  receipt: {
    path: "artifacts/scale-replay-receipt.json",
    sha256: `sha256:${createHash("sha256").update(await readFile(receiptPath)).digest("hex")}`,
  },
};
await writeFile(resolve(root, "artifacts/scale-replay.json"), JSON.stringify(replayEvidence, null, 2));
const beforeStop = serverExit;
let probe;
try { const response = await fetch(`${url}/schema`, { signal: AbortSignal.timeout(5000) }); probe = { status: response.status, body: (await response.text()).slice(0, 200) }; }
catch (e) { probe = { error: String(e), cause: String(e.cause) }; }
child.kill("SIGTERM");
await exited;
clearInterval(monitor); fdLog.end(); out.end(); err.end();
await writeFile(`${evidence}/server-exit.json`, JSON.stringify({ pid: child.pid, beforeStop, exit: serverExit, probe }, null, 2));
process.exit(pass ? 0 : 1);

async function readPrefix(path, lineCount) {
  const text = await readFile(path, "utf8");
  const lines = text.split("\n");
  return `${lines.slice(0, lineCount).join("\n")}\n`;
}
