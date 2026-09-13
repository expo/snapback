#!/usr/bin/env node
// The simulator witness: the local-first client on expo-sqlite, in Expo Go
// on the booted iOS simulator, against a real `snapback4 dev`. The app
// (apps/chat-expo) runs the scenario itself when EXPO_PUBLIC_WITNESS_URL
// is set and posts its report here; this script seeds the server, starts
// Metro, opens the app on the simulator, waits for the report, records it.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { devServer, record, root } from "./lib.mjs";

const timeoutMs = Number(process.env.WITNESS_TIMEOUT_MS ?? 600_000);
const metroPort = 8091;
const device = execSync("xcrun simctl list devices booted -j", { encoding: "utf8" });
const booted = JSON.parse(device);
// Several simulators may be booted (other lanes keep their own): WITNESS_UDID
// names ours; otherwise the first booted iPhone that is not another lane's.
const candidates = Object.values(booted.devices).flat().filter((d) => d.state === "Booted");
const udid = process.env.WITNESS_UDID ?? (candidates.find((d) => /^iPhone/.test(d.name)) ?? candidates[0])?.udid;
if (!udid) throw new Error("no booted iOS simulator: `xcrun simctl boot 'iPhone 17 Pro'` first");

const dev = await devServer({ seed: [
  { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
  { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
  { table: "memberships", row: { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 } },
  ...Array.from({ length: 300 }, (_, n) => ({ table: "messages", row: { id: `seed${String(n).padStart(4, "0")}`, conversationId: "c1", authorId: n % 2 ? "dev:alice" : "dev:bob", body: `seed ${n}`, at: 1_700_000_000_000 + n, editedAt: null, photo: null } })),
] });

// The report comes back over HTTP from the app.
let resolveReport;
const report = new Promise((r) => (resolveReport = r));
const steps = [];
const control = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.end("ok");
    if (req.method !== "POST") return;
    if (req.url === "/step") {
      steps.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${body}`);
      if (process.env.WITNESS_VERBOSE) process.stderr.write(`step ${steps[steps.length - 1]}\n`);
      return;
    }
    resolveReport(JSON.parse(body));
  });
});
const started = Date.now();
await new Promise((r) => control.listen(4498, "127.0.0.1", r));

const app = join(root, "apps/chat-expo");
// Metro is its own process group, so the whole tree dies with the witness.
try {
  const holder = execSync(`lsof -nP -iTCP:${metroPort} -sTCP:LISTEN -t`, { encoding: "utf8" }).trim();
  if (holder) throw new Error(`port ${metroPort} is held by pid ${holder} (a stale Metro?); kill it first`);
} catch (error) { if (!/Command failed/.test(String(error))) throw error; }
// WITNESS_DEV_CLIENT=1 opens the development build (the Rust module inside)
// instead of Expo Go; `npx expo run:ios` in apps/chat-expo makes one.
// In dev-client mode Metro is started without opening anything; the
// development build is launched below once Metro answers.
const devClient = Boolean(process.env.WITNESS_DEV_CLIENT);
const metro = spawn("npx", ["expo", "start", "--port", String(metroPort), "--clear", ...(devClient ? ["--dev-client"] : ["--ios"])], {
  cwd: app,
  detached: true,
  env: { ...process.env, CI: "1", EXPO_PUBLIC_SNAPBACK_URL: dev.api, EXPO_PUBLIC_WITNESS_URL: "http://127.0.0.1:4498", EXPO_NO_TELEMETRY: "1", REACT_NATIVE_PACKAGER_HOSTNAME: "127.0.0.1", ...(process.env.WITNESS_VERBOSE ? { EXPO_PUBLIC_SNAPBACK_TRACE: "1" } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
let metroLog = "";
let failBundling;
const bundlingFailed = new Promise((_, reject) => (failBundling = reject));
const onLog = (d) => {
  metroLog += d;
  if (process.env.WITNESS_VERBOSE) process.stderr.write(d);
  if (/Bundling failed/.test(String(d))) setTimeout(() => failBundling(new Error(`Metro could not bundle the app\n${metroLog.slice(-3000)}`)), 500);
};
metro.stdout.on("data", onLog);
metro.stderr.on("data", onLog);

if (devClient) {
  // Metro up, then the development build, then the link into it.
  const ready = Date.now() + 120_000;
  while (Date.now() < ready) {
    try { const r = await fetch(`http://127.0.0.1:${metroPort}/status`); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  // The launcher reads `--initialUrl` from its process arguments, so the
  // build is launched straight onto Metro; an opened link would prompt.
  const bundleId = process.env.WITNESS_APP ?? "dev.snapback4.chat";
  try { execSync(`xcrun simctl terminate ${udid} host.exp.Exponent`, { stdio: "ignore" }); } catch {}
  execSync(`xcrun simctl launch --terminate-running-processes ${udid} ${bundleId} --initialUrl http://127.0.0.1:${metroPort}`, { stdio: "ignore" });
}
const out = { at: new Date().toISOString(), witness: devClient ? "dev-client-native" : "expo-go-sqlite", simulator: udid, seeded: dev.seeded, proves: ["cold sync into SQLite", "local reads and a send", "a reopen finds the rows", "a cold start offline answers from the store", "writes composed offline survive a restart and flush in order"] };
try {
  const result = await Promise.race([report, bundlingFailed, new Promise((_, reject) => setTimeout(() => reject(new Error(`no report within ${timeoutMs} ms\n${metroLog.slice(-2000)}`)), timeoutMs))]);
  Object.assign(out, result);
  const native = result.native ?? {};
  out.ok = result.first?.threadRows === 50 && result.first?.threadComplete === true && result.first?.count === 300 && result.first?.write === "sent" && result.first?.sentRowRead === true && result.second?.reopenedRows >= 300
    && native.coldLink === "offline" && native.coldThreadRows === 50 && native.coldFresh === false
    && native.queued === "pending" && native.queuedSecond === "pending"
    && JSON.stringify(native.pendingAfterRestart) === JSON.stringify(["composed offline, second", "composed offline"])
    && JSON.stringify(native.landedOrder) === JSON.stringify(["composed offline", "composed offline, second"]);
} catch (error) {
  out.ok = false;
  out.error = String(error.message ?? error);
  out.steps = steps;
} finally {
  try { process.kill(-metro.pid, "SIGTERM"); } catch { metro.kill(); }
  control.close();
  dev.close();
}
console.log(JSON.stringify(out));
record(out);
process.exit(out.ok ? 0 : 1);
