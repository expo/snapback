#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const personas = JSON.parse(await readFile(path.resolve(armRoot, "receipts/personas.v1.json")));
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
let context;
let emulatorsStopped = false;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const emulatorPorts = [8085, 9102, 4400, 4500, 9150];
const emulatorExport = path.resolve(runtimeRoot, "offline-emulator-export");
const emulatorLog = path.resolve(runtimeRoot, "offline-emulator.log");

function admin(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve(workRoot, "scripts/admin-cli.mjs"), ...args], {
      cwd: workRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
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

function listenerPid(port) {
  try {
    const output = execFileSync(
      "lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" },
    ).trim();
    return Number(output.split(/\s+/)[0]) || undefined;
  } catch {
    return undefined;
  }
}

async function waitForPorts(expectedOpen, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = emulatorPorts.map((port) => Boolean(listenerPid(port)));
    if (states.every((state) => state === expectedOpen)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`emulator ports did not become ${expectedOpen ? "open" : "closed"}`);
}

function exactHubOwner() {
  const pid = listenerPid(4400);
  if (!pid) throw new Error("Firebase emulator hub listener missing");
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  }).trim();
  if (
    !command.includes("firebase") ||
    !command.includes("emulators:start") ||
    !command.includes("demo-llp0102-todo-firebase")
  ) {
    throw new Error("refusing to stop a non-arm emulator hub");
  }
  return { pid, command };
}

async function stopEmulators() {
  execFileSync(
    "npx",
    [
      "firebase",
      "emulators:export",
      emulatorExport,
      "--project",
      "demo-llp0102-todo-firebase",
      "--force",
    ],
    { cwd: workRoot, stdio: "ignore" },
  );
  const owner = exactHubOwner();
  process.kill(owner.pid, "SIGINT");
  await waitForPorts(false);
  emulatorsStopped = true;
  return owner;
}

async function startEmulators() {
  await mkdir(runtimeRoot, { recursive: true });
  const logFd = openSync(emulatorLog, "a", 0o600);
  const child = spawn(
    "npx",
    [
      "firebase",
      "emulators:start",
      "--project",
      "demo-llp0102-todo-firebase",
      "--only",
      "auth,firestore",
      "--import",
      emulatorExport,
    ],
    {
      cwd: workRoot,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  closeSync(logFd);
  await waitForPorts(true);
  exactHubOwner();
  emulatorsStopped = false;
}

async function openAlice() {
  context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, "chrome-alice"),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://127.0.0.1:4181/?persona=alice");
  await page.locator('.app-shell, input[aria-label="Email"]').first().waitFor({ timeout: 15_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(env.ALICE_EMAIL);
    await page.getByLabel("Password").fill(env.ALICE_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.app-shell[data-ready="true"]');
  try {
    await shell.waitFor({ timeout: 30_000 });
  } catch (reason) {
    const state = await page.evaluate(() => ({
      body: document.body.innerText,
      shell: document.querySelector(".app-shell")?.outerHTML.slice(0, 800),
      url: location.href,
    }));
    throw new Error(`Alice did not become ready: ${JSON.stringify(state)}`, { cause: reason });
  }
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== personas.principalIdHashes.alice) {
    throw new Error("Alice identity changed");
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
  const warmRowsBeforePause = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const stoppedOwner = await stopEmulators();
  await page.waitForTimeout(1_000);
  const warmRowsWhilePaused = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  await context.close();
  context = undefined;
  await new Promise((resolve) => setTimeout(resolve, 2_000));

  page = await openAlice();
  await page.locator('.app-shell[data-task-count="100"][data-from-cache="true"]')
    .waitFor({ timeout: 30_000 });
  const coldRowsWhilePaused = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const coldFromCache = await page.locator(".app-shell").getAttribute("data-from-cache");
  const marker = `Offline marker ${Date.now()}`;
  const updatedTitle = `Offline update ${Date.now()}`;
  await page.getByLabel("New task").fill(marker);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  try {
    await page.getByLabel(`Title ${marker}`).waitFor({ timeout: 10_000 });
  } catch (reason) {
    const state = await page.evaluate(() => ({
      body: document.body.innerText,
      shell: document.querySelector(".app-shell")?.outerHTML.slice(0, 800),
    }));
    throw new Error(`offline create was not rendered: ${JSON.stringify(state)}`, { cause: reason });
  }
  const input = page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
  await input.fill(updatedTitle);
  await input.press("Tab");
  await page.getByLabel(`Title ${updatedTitle}`).waitFor({ timeout: 10_000 });
  const optimisticCount = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const pendingWrites = await page.locator(".app-shell").getAttribute("data-pending-writes");
  const queueUi = await page.getByTestId("todo-offline-state").innerText();
  const indexedDbDatabaseCount = await page.evaluate(async () =>
    (await indexedDB.databases()).filter((item) => item.name).length
  );
  if (emulatorPorts.some((port) => listenerPid(port))) {
    throw new Error("an emulator listener reopened before the reconnect step");
  }
  await startEmulators();
  await page.locator('.app-shell[data-pending-writes="false"][data-from-cache="false"]')
    .waitFor({ timeout: 45_000 });
  await page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
  const settled = await admin("summary");
  const authoritativeTask = await admin("probe", taskId);
  const markerCopies = await page.getByLabel(`Title ${marker}`).count();
  await page.getByRole("button", { name: `Delete ${marker}` }).click();
  const restore = page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
  await restore.fill(originalTitle);
  await restore.press("Tab");
  await page.locator('.app-shell[data-task-count="100"][data-pending-writes="false"]')
    .waitFor({ timeout: 30_000 });
  const restored = await admin("summary");

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      warmRowsBeforePause === 100 &&
      warmRowsWhilePaused === 100 &&
      coldRowsWhilePaused === 100 &&
      coldFromCache === "true" &&
      optimisticCount === 101 &&
      pendingWrites === "true" &&
      settled.taskCount === 101 &&
      authoritativeTask.title === updatedTitle &&
      markerCopies === 1 &&
      restored.taskCount === 100,
    transportBarrier: {
      exactHubPid: stoppedOwner.pid,
      exactHubCommandVerified: true,
      exportedBeforeStop: true,
      allFiveArmPortsClosed: true,
      restartedFromExport: true,
    },
    warmRowsBeforePause,
    warmRowsWhilePaused,
    coldBoot: {
      retainedRows: coldRowsWhilePaused,
      snapshotFromCache: coldFromCache === "true",
      indexedDbDatabaseCount,
    },
    offlineWrites: {
      optimisticTaskCount: optimisticCount,
      snapshotHasPendingWrites: pendingWrites === "true",
      queueUi,
      remoteCommitImpossibleWhileAllEmulatorPortsClosed: true,
    },
    reconnect: {
      authoritativeTaskCount: settled.taskCount,
      authoritativeUpdateVisible: authoritativeTask.title === updatedTitle,
      markerCopies,
      restoredBaselineCount: restored.taskCount,
    },
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
  await context?.close().catch(() => {});
  if (emulatorsStopped) {
    await startEmulators().catch(() => {});
  }
  await admin("cleanup", "Offline marker").catch(() => {});
}
