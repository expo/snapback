#!/usr/bin/env node
// Scheduled native witness uses exactly the published CLI and app helper.
// Install the chat-expo Release build on a dedicated booted simulator first.
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { binary, record, root } from "./lib.mjs";

const udid = process.env.WITNESS_UDID;
if (!udid) throw new Error("WITNESS_UDID must name your dedicated booted iOS simulator");
const port = process.env.WITNESS_PORT ?? "4400"; // Match EXPO_PUBLIC_SNAPBACK_URL in the installed Release app.
const artifacts = resolve(process.env.WITNESS_ARTIFACTS ?? join(root, "metrics", `expo-${Date.now()}`));
const project = mkdtempSync(join(tmpdir(), "sb4-expo-witness-"));
cpSync(join(root, "apps/chat/snapback"), join(project, "snapback"), { recursive: true, filter: path => !/\/worker\.(ts|mjs)$/.test(path) });
mkdirSync(artifacts, { recursive: true });
const started = Date.now();
let child;
const stop = () => child?.kill("SIGTERM");
process.on("SIGINT", stop); process.on("SIGTERM", stop);
try {
  for (const segment of ["offline", "restart"]) {
    const args = ["witness", "ios", "--bundle-id", "dev.snapback4.chat", "--udid", udid,
      "--segment", segment, "--artifacts", artifacts, "--port", port, "--prime",
      ...(segment === "restart" ? ["--relaunch"] : [])];
    const exit = await new Promise((resolve, reject) => {
      child = spawn(binary(), args, { cwd: project, stdio: "inherit" });
      child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    child = undefined;
    if (exit.code !== 0) throw new Error(`published witness ${segment} failed: ${JSON.stringify(exit)}; artifacts: ${artifacts}`);
    const manifest = JSON.parse(readFileSync(join(artifacts, `${segment}-ios-run.json`), "utf8"));
    record({ at: new Date().toISOString(), witness: "published-ios", segment, simulator: udid,
      ok: manifest.exitStatus === 0, ms: manifest.endedAt - manifest.startedAt, manifest: join(artifacts, `${segment}-ios-run.json`) });
  }
  console.log(JSON.stringify({ witness: "published-ios", ok: true, ms: Date.now() - started, artifacts }));
} finally {
  stop(); process.off("SIGINT", stop); process.off("SIGTERM", stop);
  rmSync(project, { recursive: true, force: true });
}
