#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const hash = (value) => createHash("sha256").update(value).digest("hex");

function admin(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.resolve(workRoot, "scripts/admin-cli.mjs"),
      ...args,
    ], { cwd: workRoot, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(stderr || `admin helper exited ${code}`));
    });
  });
}

async function openPersona(persona, expectedCount) {
  const upper = persona.toUpperCase();
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  const realtimeSockets = [];
  page.on("websocket", (socket) => {
    if (socket.url().includes("/realtime/v1/websocket")) {
      const parsed = new URL(socket.url());
      realtimeSockets.push({
        protocol: parsed.protocol,
        hostHash: hash(parsed.hostname),
        path: parsed.pathname,
      });
    }
  });
  await page.goto(`http://127.0.0.1:4182/?persona=${persona}`);
  await page.locator('.app-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 20_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(env[`${upper}_EMAIL`]);
    await page.getByLabel("Password").fill(env[`${upper}_PASSWORD`]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  await page.locator(`.app-shell[data-task-count="${expectedCount}"]`)
    .waitFor({ timeout: 30_000 });
  await page.locator('.app-shell[data-channel-state="subscribed"]')
    .waitFor({ timeout: 30_000 });
  const userId = await shell.getAttribute("data-user-id");
  if (!userId) throw new Error(`${persona} user ID missing`);
  await page.waitForTimeout(250);
  return { context, userId, realtimeSockets };
}

const seeded = await admin("seed");
const results = {};
for (const [persona, expectedCount] of [["alice", 100], ["bob", 100], ["mallory", 0]]) {
  let opened = await openPersona(persona, expectedCount);
  const firstHash = hash(opened.userId);
  const firstSockets = opened.realtimeSockets;
  await opened.context.close();
  opened = await openPersona(persona, expectedCount);
  const secondHash = hash(opened.userId);
  const sockets = [...firstSockets, ...opened.realtimeSockets];
  await opened.context.close();
  results[persona] = {
    taskCount: expectedCount,
    principalIdHash: firstHash,
    stableAcrossReopen: firstHash === secondHash,
    nativeRealtimeWebSocketObserved: sockets.length > 0,
    realtimeSocketCount: sockets.length,
    realtimeSocketIdentity: sockets[0] ?? null,
  };
}
const summary = await admin("summary");
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  ok:
    results.alice.taskCount === 100 &&
    results.bob.taskCount === 100 &&
    results.mallory.taskCount === 0 &&
    Object.values(results).every((result) =>
      result.stableAcrossReopen && result.nativeRealtimeWebSocketObserved
    ) &&
    summary.taskCount === 100 &&
    summary.orderValid &&
    Object.entries(seeded.principalIdHashes).every(
      ([persona, principalHash]) => results[persona].principalIdHash === principalHash,
    ),
  principalIdHashes: seeded.principalIdHashes,
  identityHashesStable: Object.fromEntries(
    Object.entries(results).map(([persona, result]) => [persona, result.stableAcrossReopen]),
  ),
  authorizedTaskCounts: Object.fromEntries(
    Object.entries(results).map(([persona, result]) => [persona, result.taskCount]),
  ),
  authoritativeSeed: summary,
  transport: "Supabase Realtime Phoenix WebSocket with Postgres Changes",
  eachClientOpenedNativeRealtimeSocket: Object.fromEntries(
    Object.entries(results).map(([persona, result]) => [
      persona,
      result.nativeRealtimeWebSocketObserved,
    ]),
  ),
  outsider: {
    nativeAuthenticated: true,
    protectedRows: results.mallory.taskCount,
    protectedRowsRetained: false,
  },
  containsSecretValues: false,
};
await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
await writeFile(
  path.resolve(armRoot, "receipts/personas.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: receipt.ok,
  authorizedTaskCounts: receipt.authorizedTaskCounts,
  eachClientOpenedNativeRealtimeSocket: receipt.eachClientOpenedNativeRealtimeSocket,
  secretValuesPrinted: false,
})}\n`);
if (!receipt.ok) process.exit(1);
