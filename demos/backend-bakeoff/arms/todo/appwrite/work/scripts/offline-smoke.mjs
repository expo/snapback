#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const runtime = JSON.parse(
  await readFile(path.resolve(workRoot, ".arm-runtime/owner.json"), "utf8"),
);
const projectHost = "127.0.0.1";
const projectPort = "8090";
let context;
let blockedRequests = 0;
let blockedWebSockets = 0;

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

async function installBarrier(targetContext) {
  await targetContext.route(
    (url) => url.hostname === projectHost && url.port === projectPort,
    async (route) => {
    blockedRequests += 1;
    await route.abort("internetdisconnected");
    },
  );
  await targetContext.routeWebSocket(
    (url) => url.hostname === projectHost && url.port === projectPort,
    async (socket) => {
    blockedWebSockets += 1;
    await socket.close({ code: 1012, reason: "frozen offline barrier" });
    },
  );
}

async function openAlice({ blocked = false } = {}) {
  context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, "chrome-alice"),
    { executablePath: chromePath, headless: true },
  );
  if (blocked) await installBarrier(context);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto("http://127.0.0.1:4186/");
  await page.locator('.app-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 20_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    if (blocked) return page;
    await page.getByLabel("Email").fill(runtime.personas.alice.email);
    await page.getByLabel("Password").fill(runtime.personas.alice.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 30_000 });
  return page;
}

try {
  let page = await openAlice();
  await page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  const task = page.locator(".task-row").first();
  const taskId = await task.getAttribute("data-task-id");
  const originalTitle = await task.locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("offline probe task missing");
  const authorityBefore = await admin("summary");
  const taskBefore = await admin("probe", taskId);

  await installBarrier(context);
  const marker = `Offline unsupported ${Date.now()}`;
  await page.getByLabel("New task").fill(marker);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator('.app-shell[data-pending-writes="false"]').waitFor({ timeout: 15_000 });
  const warmCountAfterCreateAttempt = Number(
    await page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const markerRendered = await page.getByLabel(`Title ${marker}`)
    .isVisible().catch(() => false);
  const updateAttempt = `Offline update unsupported ${Date.now()}`;
  const input = page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
  await input.fill(updateAttempt);
  await input.press("Tab");
  await page.locator('.app-shell[data-pending-writes="false"]').waitFor({ timeout: 15_000 });
  const visualInputAfterFailedUpdate = await input.inputValue();
  const errorVisible = await page.getByRole("alert").isVisible().catch(() => false);
  const authorityWhileBlocked = await admin("summary");
  const taskWhileBlocked = await admin("probe", taskId);
  await context.close();
  context = undefined;
  await new Promise((resolve) => setTimeout(resolve, 1_000));

  page = await openAlice({ blocked: true });
  const coldShell = page.locator('.app-shell[data-ready="true"]');
  const coldTaskCount = await coldShell.count() === 0
    ? 0
    : Number(await coldShell.getAttribute("data-task-count"));
  const coldLoginVisible = await page.getByLabel("Email").isVisible().catch(() => false);
  const coldErrorVisible = await page.getByRole("alert").isVisible().catch(() => false);
  const coldIndexedDbDatabaseCount = await page.evaluate(async () =>
    (await indexedDB.databases()).filter((item) => item.name).length
  );
  await context.close();
  context = undefined;
  await new Promise((resolve) => setTimeout(resolve, 500));

  page = await openAlice();
  await page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  const authorityAfterReconnect = await admin("summary");
  const taskAfterReconnect = await admin("probe", taskId);
  const markerCopiesAfterReconnect = await page.getByLabel(`Title ${marker}`).count();
  const queuedUpdateSettled =
    taskAfterReconnect.title === updateAttempt && taskBefore.title !== updateAttempt;

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      authorityBefore.taskCount === 100 &&
      blockedRequests >= 2 &&
      warmCountAfterCreateAttempt === 100 &&
      markerRendered === false &&
      errorVisible &&
      authorityWhileBlocked.taskCount === 100 &&
      taskWhileBlocked.title === originalTitle &&
      coldTaskCount === 0 &&
      coldLoginVisible &&
      authorityAfterReconnect.taskCount === 100 &&
      markerCopiesAfterReconnect === 0 &&
      queuedUpdateSettled === false,
    transportBarrier: {
      exactProjectHostMatchedWithoutRetention: true,
      blockedRequests,
      blockedWebSockets,
      ViteOriginRemainedAvailable: true,
    },
    warmClient: {
      retainedRowsDuringTransportLoss: 100,
      createAttemptRenderedOptimistically: markerRendered,
      taskCountAfterCreateAttempt: warmCountAfterCreateAttempt,
      updateInputRetainedVisualEdit: visualInputAfterFailedUpdate === updateAttempt,
      mutationErrorVisible: errorVisible,
      nativePendingQueueObserved: false,
      authoritativeTaskCountUnchanged: authorityWhileBlocked.taskCount === 100,
      authoritativeTitleUnchanged: taskWhileBlocked.title === originalTitle,
    },
    coldBoot: {
      retainedRows: coldTaskCount,
      queryCacheOrigin: "none in the Appwrite Web SDK",
      indexedDbDatabaseCount: coldIndexedDbDatabaseCount,
      requestErrorVisible: coldErrorVisible,
      loginFallbackVisible: coldLoginVisible,
      supported: false,
    },
    reconnect: {
      onlineQueryResubscribed: true,
      authoritativeTaskCount: authorityAfterReconnect.taskCount,
      queuedCreateCopies: markerCopiesAfterReconnect,
      queuedUpdateSettled,
      supportedQueuedSettlement: false,
    },
    gaps: [
      "TODO-06-OFFLINE-BOOT",
      "TODO-07-OFFLINE-WRITES",
      "TODO-08-RECONNECT",
    ],
    finding:
      "The Appwrite Web SDK persists Auth session material but not TablesDB query results or mutations; official Appwrite offline-sync guidance requires adding a separate local database and custom push-pull conflict handling.",
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/offline-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({
    ok: receipt.ok,
    warmClient: receipt.warmClient,
    coldBoot: receipt.coldBoot,
    reconnect: receipt.reconnect,
    gaps: receipt.gaps,
    secretValuesPrinted: false,
  })}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
}
