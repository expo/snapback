#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let backendStopped = false;
const contexts = [];

function backendPid() {
  const pid = Number(
    execFileSync("lsof", ["-nP", "-iTCP:3210", "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    }).trim(),
  );
  if (!Number.isInteger(pid) || pid <= 1) throw new Error("Convex backend PID missing");
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  }).trim();
  if (
    !command.includes("convex-local-backend") ||
    !command.includes(path.resolve(workRoot, ".convex/local"))
  ) {
    throw new Error("refusing to pause a backend not owned by this arm");
  }
  return pid;
}

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  contexts.push(context);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:4179/?persona=${persona}`);
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 20_000 });
  return { context, page };
}

try {
  let alice = await openPersona("alice");
  const bob = await openPersona("bob");
  await bob.page.locator("li").first().waitFor({ timeout: 20_000 });
  const target = bob.page.locator("li").first();
  const taskId = await target.getAttribute("data-task-id");
  const originalTitle = await target
    .locator('input:not([type="checkbox"])')
    .inputValue();
  if (!taskId) throw new Error("offline update target missing");

  const pid = backendPid();
  process.kill(pid, "SIGSTOP");
  backendStopped = true;
  await bob.page.waitForTimeout(750);
  const warmRowsWhileOffline = Number(
    await bob.page.locator(".app-shell").getAttribute("data-task-count"),
  );

  await alice.context.close();
  contexts.splice(contexts.indexOf(alice.context), 1);
  const coldContext = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, "chrome-alice"),
    { executablePath: chromePath, headless: true },
  );
  contexts.push(coldContext);
  const coldPage = coldContext.pages()[0] ?? (await coldContext.newPage());
  await coldPage.goto("http://127.0.0.1:4179/?persona=alice");
  const coldShellAppeared = await coldPage
    .locator(".app-shell")
    .waitFor({ timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  const coldRowsWhileOffline = coldShellAppeared
    ? Number(await coldPage.locator(".app-shell").getAttribute("data-task-count"))
    : 0;

  const marker = `Offline marker ${Date.now()}`;
  const updatedTitle = `Offline update ${Date.now()}`;
  await bob.page.getByLabel("New task").fill(marker);
  await bob.page.getByRole("button", { name: "Add", exact: true }).click();
  const updateInput = bob.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await updateInput.fill(updatedTitle);
  await updateInput.press("Tab");
  const queuedUiProof = {
    createFormCleared: (await bob.page.getByLabel("New task").inputValue()) === "",
    updateInputContainsOfflineValue:
      (await updateInput.inputValue()) === updatedTitle,
    remoteCountUnchanged: Number(
      await bob.page.locator(".app-shell").getAttribute("data-task-count"),
    ) === 100,
  };

  process.kill(pid, "SIGCONT");
  backendStopped = false;
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
  await bob.page.getByLabel(`Title ${updatedTitle}`).waitFor({ timeout: 30_000 });
  await coldPage
    .locator('.app-shell[data-ready="true"][data-task-count="101"]')
    .waitFor({ timeout: 30_000 });
  const settledCount = Number(
    await bob.page.locator(".app-shell").getAttribute("data-task-count"),
  );
  const markerCopies = await bob.page.getByLabel(`Title ${marker}`).count();

  await bob.page.getByRole("button", { name: `Delete ${marker}` }).click();
  const restoreInput = bob.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreInput.fill(originalTitle);
  await restoreInput.press("Tab");
  await bob.page
    .locator('.app-shell[data-task-count="100"]')
    .waitFor({ timeout: 20_000 });

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      warmRowsWhileOffline === 100 &&
      coldRowsWhileOffline === 0 &&
      Object.values(queuedUiProof).every(Boolean) &&
      settledCount === 101 &&
      markerCopies === 1,
    warmRowsWhileOffline,
    coldBoot: {
      shellAppeared: coldShellAppeared,
      retainedRows: coldRowsWhileOffline,
    },
    queuedUiProof,
    reconnect: {
      settledCount,
      markerCopies,
      coldClientResubscribed: true,
      createAndUpdateVisible: true,
    },
    finding:
      "warm in-memory query data survives transport loss and mutation calls queue for retry; a closed-and-reopened client has no durable retained query result",
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
  if (backendStopped) {
    try {
      process.kill(backendPid(), "SIGCONT");
    } catch {
      // The guarded cleanup path will diagnose a missing backend separately.
    }
  }
  await Promise.all(contexts.map((context) => context.close()));
}
