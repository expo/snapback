#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const container = "llp0102_todo_instantdb-server-1";
const expectedAliceHash = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/personas.v1.json"), "utf8"),
).principalIdHashes.alice;
let serverStopped = false;
let context;

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

function assertOwnedContainer() {
  const project = execFileSync("docker", [
    "inspect",
    "--format",
    "{{ index .Config.Labels \"com.docker.compose.project\" }}",
    container,
  ], { encoding: "utf8" }).trim();
  if (project !== "llp0102_todo_instantdb") {
    throw new Error(`refusing to control non-arm container (${project})`);
  }
}

function stopServer() {
  assertOwnedContainer();
  execFileSync("docker", ["stop", "--time", "5", container], { stdio: "ignore" });
  serverStopped = true;
}

function startServer() {
  assertOwnedContainer();
  execFileSync("docker", ["start", container], { stdio: "ignore" });
  serverStopped = false;
}

async function openAlice() {
  context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, "chrome-alice"),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://127.0.0.1:4180/?persona=alice");
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || createHash("sha256").update(userId).digest("hex") !== expectedAliceHash) {
    throw new Error("Alice native identity changed");
  }
  return page;
}

try {
  let page = await openAlice();
  await page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  const target = page.locator(".task-row").first();
  const taskId = await target.getAttribute("data-task-id");
  const originalTitle = await target.locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("offline update target missing");
  const warmRowsBeforeStop = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );

  stopServer();
  await page.locator('.app-shell[data-connection="closed"]').waitFor({ timeout: 20_000 });
  const warmRowsWhileOffline = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  await context.close();
  context = undefined;

  page = await openAlice();
  const coldRowsWhileOffline = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const coldConnection = await page.locator(".app-shell").getAttribute("data-connection");
  const marker = `Offline marker ${Date.now()}`;
  const updatedTitle = `Offline update ${Date.now()}`;
  await page.getByLabel("New task").fill(marker);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel(`Title ${marker}`).waitFor({ timeout: 10_000 });
  const updateInput = page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await updateInput.fill(updatedTitle);
  await updateInput.press("Tab");
  await page.getByLabel(`Title ${updatedTitle}`).waitFor({ timeout: 10_000 });
  const queueUi = await page.getByTestId("todo-offline-state").innerText();
  const optimisticOfflineCount = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const indexedDbDatabaseCount = await page.evaluate(async () =>
    (await indexedDB.databases()).filter((item) => item.name).length,
  );

  startServer();
  await page.locator('.app-shell[data-connection="authenticated"]').waitFor({ timeout: 45_000 });
  await page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
  await page.getByLabel(`Title ${updatedTitle}`).waitFor({ timeout: 30_000 });
  const settled = await admin("summary");
  const authoritativeTask = await admin("probe", taskId);
  const markerQuery = await admin("cleanup", "__non_matching_probe__");
  const markerCopiesInUi = await page.getByLabel(`Title ${marker}`).count();

  await page.getByRole("button", { name: `Delete ${marker}` }).click();
  const restoreInput = page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreInput.fill(originalTitle);
  await restoreInput.press("Tab");
  await page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  const restored = await admin("summary");

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      warmRowsBeforeStop === 100 &&
      warmRowsWhileOffline === 100 &&
      coldRowsWhileOffline === 100 &&
      coldConnection === "closed" &&
      optimisticOfflineCount === 101 &&
      queueUi.toLowerCase().includes("queued") &&
      settled.taskCount === 101 &&
      authoritativeTask.title === updatedTitle &&
      markerCopiesInUi === 1 &&
      restored.taskCount === 100,
    transportBarrier: {
      exactContainer: container,
      ownershipLabelVerified: true,
      serverStopped: true,
      browserConnectionState: coldConnection,
    },
    warmRowsBeforeStop,
    warmRowsWhileOffline,
    coldBoot: {
      retainedRows: coldRowsWhileOffline,
      retainedOrigin: "InstantDB IndexedDB query cache",
      indexedDbDatabaseCount,
    },
    offlineWrites: {
      optimisticTaskCount: optimisticOfflineCount,
      queueUi,
      oneCreateVisible: true,
      oneUpdateVisible: true,
      remoteCommitImpossibleWhileContainerStopped: true,
    },
    reconnect: {
      authoritativeTaskCount: settled.taskCount,
      authoritativeUpdateVisible: authoritativeTask.title === updatedTitle,
      markerCopies: markerCopiesInUi,
      restoredBaselineCount: restored.taskCount,
    },
    nonMatchingCleanupProbe: markerQuery,
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/offline-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  if (serverStopped) {
    try {
      startServer();
    } catch {
      // Target-bound cleanup will report a server that could not be restarted.
    }
  }
  await context?.close().catch(() => {});
  await admin("cleanup", "Offline marker").catch(() => {});
}
