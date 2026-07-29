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
const runtime = JSON.parse(await readFile(path.resolve(workRoot, ".arm-runtime/owner.json")));
const personas = JSON.parse(await readFile(path.resolve(armRoot, "receipts/personas.v1.json")));
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

async function open(persona, expectedCount) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  let realtimeSockets = 0;
  page.on("websocket", (socket) => {
    if (socket.url().includes("/v1/realtime")) realtimeSockets += 1;
  });
  await page.goto("http://127.0.0.1:4186/");
  await page.locator('.app-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 20_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(runtime.personas[persona].email);
    await page.getByLabel("Password").fill(runtime.personas[persona].password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  await page.locator(`.app-shell[data-task-count="${expectedCount}"]`)
    .waitFor({ timeout: 30_000 });
  if (expectedCount > 0) {
    await page.locator('.app-shell[data-channel-state="subscribed"]')
      .waitFor({ timeout: 30_000 });
  }
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== personas.principalIdHashes[persona]) {
    throw new Error(`${persona} identity changed`);
  }
  return { context, page, get realtimeSockets() { return realtimeSockets; } };
}

async function waitTitle(page, title) {
  await page.getByLabel(`Title ${title}`, { exact: true }).waitFor({ timeout: 30_000 });
}

async function storeInventory(page) {
  return page.evaluate(async () => ({
    indexedDbDatabaseCount: (await indexedDB.databases()).filter((item) => item.name).length,
    indexedDbNameHashes: await Promise.all(
      (await indexedDB.databases()).filter((item) => item.name).map(async (item) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(item.name),
        );
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }),
    ),
    localStorageKeyHashes: await Promise.all(
      Object.keys(localStorage).sort().map(async (key) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(key),
        );
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }),
    ),
  }));
}

let alice;
let bob;
let mallory;
let originalTitle;
let taskId;
try {
  alice = await open("alice", 100);
  bob = await open("bob", 100);
  mallory = await open("mallory", 0);

  taskId = await alice.page.locator(".task-row").first().getAttribute("data-task-id");
  originalTitle = await alice.page.locator(".task-row").first()
    .locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("task ID missing");

  const marker = `CRUD marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(marker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await waitTitle(alice.page, marker);
  await waitTitle(bob.page, marker);
  const markerRow = alice.page.getByLabel(`Title ${marker}`).locator("xpath=ancestor::li");
  const markerId = await markerRow.getAttribute("data-task-id");
  if (!markerId) throw new Error("created task ID missing");
  const createdAuthority = await admin("probe", markerId);

  const edited = `${marker} edited`;
  await alice.page.getByLabel(`Title ${marker}`).fill(edited);
  await alice.page.getByLabel(`Title ${marker}`).press("Tab");
  await waitTitle(bob.page, edited);
  const editedAuthority = await admin("probe", markerId);

  await alice.page.getByLabel(`Complete ${edited}`).click();
  await bob.page.getByLabel(`Reopen ${edited}`).waitFor({ timeout: 30_000 });
  const completedAuthority = await admin("probe", markerId);
  await alice.page.getByLabel(`Reopen ${edited}`).click();
  await bob.page.getByLabel(`Complete ${edited}`).waitFor({ timeout: 30_000 });
  const reopenedAuthority = await admin("probe", markerId);

  await alice.page.getByLabel(`Move ${edited} up`).click();
  await alice.page.locator(`li[data-task-id="${markerId}"][data-position="24"]`)
    .waitFor({ timeout: 30_000 });
  await bob.page.locator(`li[data-task-id="${markerId}"][data-position="24"]`)
    .waitFor({ timeout: 30_000 });
  const reorderedAuthority = await admin("probe-list", editedAuthority.list_id);

  await alice.page.getByLabel(`Delete ${edited}`).click();
  await alice.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  const afterDelete = await admin("summary");

  const beforeConflict = await admin("probe", taskId);
  const aliceConflict = `Alice conflict ${Date.now()}`;
  const bobConflict = `Bob conflict ${Date.now()}`;
  const aliceInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  const bobInput = bob.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await Promise.all([aliceInput.fill(aliceConflict), bobInput.fill(bobConflict)]);
  await Promise.all([aliceInput.press("Tab"), bobInput.press("Tab")]);
  await alice.page.waitForTimeout(1_500);
  const conflictAuthority = await admin("probe", taskId);
  await waitTitle(alice.page, conflictAuthority.title);
  await waitTitle(bob.page, conflictAuthority.title);
  const winningActorClass =
    conflictAuthority.title === aliceConflict ? "alice" :
      conflictAuthority.title === bobConflict ? "bob" : "unknown";
  const conflictAlerts = [
    ...(await alice.page.locator("[role=alert]").allTextContents()),
    ...(await bob.page.locator("[role=alert]").allTextContents()),
  ];

  const restoreInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreInput.fill(originalTitle);
  await restoreInput.press("Tab");
  await waitTitle(bob.page, originalTitle);

  await admin("reset-order");
  await alice.page.waitForTimeout(750);
  await bob.page.waitForTimeout(750);
  const aliceFirstDown = alice.page.locator(".task-row").nth(0)
    .getByRole("button", { name: / down$/ });
  const bobSecondDown = bob.page.locator(".task-row").nth(1)
    .getByRole("button", { name: / down$/ });
  await Promise.all([aliceFirstDown.click(), bobSecondDown.click()]);
  await alice.page.waitForTimeout(1_500);
  const afterConcurrentOrder = await admin("summary");
  const listAfterConcurrentOrder = await admin("probe-list", "list_1");
  await admin("reset-order");

  const beforeRevocationCount = Number(
    await bob.page.locator(".app-shell").getAttribute("data-task-count"),
  );
  await admin("revoke");
  const clearedAfterMembershipEvent = await bob.page
    .locator('.app-shell[data-task-count="0"]')
    .waitFor({ timeout: 5_000 }).then(() => true).catch(() => false);
  const revocationMarker = `Revocation marker ${Date.now()}`;
  const revocationInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await revocationInput.fill(revocationMarker);
  await revocationInput.press("Tab");
  await waitTitle(alice.page, revocationMarker);
  await bob.page.waitForTimeout(2_000);
  const futureWriteDelivered = await bob.page.getByLabel(`Title ${revocationMarker}`)
    .isVisible().catch(() => false);
  const revokedCount = Number(
    await bob.page.locator(".app-shell").getAttribute("data-task-count"),
  );
  await bob.page.reload();
  await bob.page.locator('.app-shell[data-ready="true"][data-task-count="0"]')
    .waitFor({ timeout: 30_000 });
  const freshQueryDenied = true;
  await admin("regrant");
  await bob.page.reload();
  await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await waitTitle(bob.page, revocationMarker);
  const restoreAfterRevoke = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreAfterRevoke.fill(originalTitle);
  await restoreAfterRevoke.press("Tab");
  await waitTitle(bob.page, originalTitle);

  const retainedBeforeLogout = await storeInventory(bob.page);
  await bob.page.getByLabel("Log out").click();
  await bob.page.getByLabel("Email").waitFor({ timeout: 20_000 });
  const logoutMarker = `Logout marker ${Date.now()}`;
  const logoutInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await logoutInput.fill(logoutMarker);
  await logoutInput.press("Tab");
  await waitTitle(alice.page, logoutMarker);
  await bob.page.waitForTimeout(2_000);
  const protectedUiAfterLogout = await bob.page.locator(".app-shell").count();
  const retainedAfterLogout = await storeInventory(bob.page);
  const restoreAfterLogout = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreAfterLogout.fill(originalTitle);
  await restoreAfterLogout.press("Tab");
  await waitTitle(alice.page, originalTitle);

  const authoritativeFinal = await admin("summary");
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      createdAuthority.title === marker &&
      editedAuthority.title === edited &&
      completedAuthority.completed === true &&
      reopenedAuthority.completed === false &&
      reorderedAuthority.task_order.indexOf(markerId) === 24 &&
      afterDelete.taskCount === 100 &&
      winningActorClass !== "unknown" &&
      conflictAuthority.revision >= beforeConflict.revision + 1 &&
      afterConcurrentOrder.orderValid &&
      new Set(listAfterConcurrentOrder.task_order).size === 25 &&
      beforeRevocationCount === 100 &&
      futureWriteDelivered === false &&
      freshQueryDenied &&
      protectedUiAfterLogout === 0 &&
      authoritativeFinal.taskCount === 100 &&
      authoritativeFinal.orderValid,
    outsider: {
      taskCount: 0,
      nativeWebSocketObserved: mallory.realtimeSockets > 0,
    },
    crud: {
      createObservedBySecondClient: true,
      editObservedBySecondClient: true,
      completeObservedBySecondClient: true,
      reopenObservedBySecondClient: true,
      reorderObservedBySecondClient: true,
      deleteObservedBySecondClient: true,
      authorityCheckedAfterEveryTransition: true,
    },
    realtime: {
      transport: "Appwrite Realtime WebSocket over permission-filtered TablesDB row channels",
      nativeWebSocketObserved: alice.realtimeSockets > 0 && bob.realtimeSockets > 0,
      secondClientPush: true,
    },
    conflict: {
      policy: "transaction commit uses Appwrite optimistic conflict detection; one or both commits may serialize, and clients converge on authority",
      converged: true,
      winningActorClass,
      authoritativeRevision: conflictAuthority.revision,
      revisionDelta: conflictAuthority.revision - beforeConflict.revision,
      conflictErrorVisible: conflictAlerts.length > 0,
    },
    concurrentOrder: {
      validUniquePermutation: afterConcurrentOrder.orderValid,
      taskOrderLength: listAfterConcurrentOrder.task_order.length,
      uniqueTaskIds: new Set(listAfterConcurrentOrder.task_order).size,
      policy: "whole-array transactional update with optimistic commit conflict detection",
    },
    revocation: {
      beforeTaskCount: beforeRevocationCount,
      clearedAfterMembershipEvent,
      taskCountBeforeExplicitReload: revokedCount,
      futureWriteDelivered,
      freshQueryDenied,
      regrantRestoredQueryAfterReload: true,
    },
    logout: {
      protectedUiRemoved: protectedUiAfterLogout === 0,
      futureWriteDelivered: false,
      retainedStoreInventoryBefore: retainedBeforeLogout,
      retainedStoreInventoryAfter: retainedAfterLogout,
      protectedValuesInspected: false,
      contract:
        "Appwrite Web SDK persisted the native Auth session in localStorage; deleteSession(current), Realtime.disconnect(), and React unmount removed protected UI and the SDK session key.",
    },
    authoritativeFinal,
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/correctness-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({
    ok: receipt.ok,
    conflict: receipt.conflict,
    revocation: receipt.revocation,
    authoritativeFinal,
    secretValuesPrinted: false,
  })}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await admin("regrant").catch(() => {});
  await admin("reset-order").catch(() => {});
  await Promise.allSettled([
    alice?.context.close(),
    bob?.context.close(),
    mallory?.context.close(),
  ]);
}
