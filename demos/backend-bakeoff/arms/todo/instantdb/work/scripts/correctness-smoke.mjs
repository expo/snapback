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
const expectedHashes = JSON.parse(
  await readFile(path.resolve(armRoot, "receipts/personas.v1.json"), "utf8"),
).principalIdHashes;
const opened = [];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(`http://127.0.0.1:4180/?persona=${persona}`);
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== expectedHashes[persona]) {
    throw new Error(`${persona} native identity changed`);
  }
  return { persona, context, page, sockets, userId };
}

const count = async (actor) =>
  Number(await actor.page.locator(".app-shell").getAttribute("data-task-count"));

try {
  for (const persona of ["alice", "bob", "mallory"]) {
    opened.push(await openPersona(persona));
  }
  const [alice, bob, mallory] = opened;
  if ((await count(alice)) !== 100 || (await count(bob)) !== 100 || (await count(mallory)) !== 0) {
    throw new Error("persona authorization baseline drifted");
  }

  const first = alice.page.locator(".task-row").first();
  const taskId = await first.getAttribute("data-task-id");
  const originalTitle = await first.locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("first task ID missing");

  const editedTitle = `Edited ${Date.now()}`;
  await first.locator('input:not([type="checkbox"])').fill(editedTitle);
  await first.locator('input:not([type="checkbox"])').press("Tab");
  await bob.page.getByLabel(`Title ${editedTitle}`).waitFor({ timeout: 30_000 });
  await alice.page
    .locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`)
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-completed="true"]`)
    .waitFor({ timeout: 30_000 });
  await alice.page
    .locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`)
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-completed="false"]`)
    .waitFor({ timeout: 30_000 });
  await alice.page
    .locator(`li[data-task-id="${taskId}"]`)
    .getByRole("button", { name: `Move ${editedTitle} down` })
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-position="1"]`)
    .waitFor({ timeout: 30_000 });
  await alice.page
    .locator(`li[data-task-id="${taskId}"]`)
    .getByRole("button", { name: `Move ${editedTitle} up` })
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-position="0"]`)
    .waitFor({ timeout: 30_000 });

  const marker = `Realtime marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(marker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
  const realtimeTransportObserved = bob.sockets.some((url) =>
    url.startsWith("ws://127.0.0.1:8889/runtime/session"),
  );
  await alice.page.getByRole("button", { name: `Delete ${marker}` }).click();
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ state: "detached", timeout: 30_000 });

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
  await alice.page.waitForTimeout(750);
  const authoritativeConflict = await admin("probe", taskId);
  await alice.page.getByLabel(`Title ${authoritativeConflict.title}`).waitFor({ timeout: 30_000 });
  await bob.page.getByLabel(`Title ${authoritativeConflict.title}`).waitFor({ timeout: 30_000 });
  const conflictConverged =
    authoritativeConflict.title === aliceConflict ||
    authoritativeConflict.title === bobConflict;

  const firstId = await alice.page.locator(".task-row").first().getAttribute("data-task-id");
  const lastId = await bob.page.locator(".task-row").last().getAttribute("data-task-id");
  if (!firstId || !lastId) throw new Error("order barrier tasks missing");
  await Promise.all([
    alice.page.locator(`li[data-task-id="${firstId}"]`).getByRole("button", { name: / down$/ }).click(),
    bob.page.locator(`li[data-task-id="${lastId}"]`).getByRole("button", { name: / up$/ }).click(),
  ]);
  await alice.page.waitForTimeout(750);
  const positions = await alice.page.locator(".task-row").evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-position"))).sort((a, b) => a - b),
  );
  const concurrentOrderValid =
    positions.length === 25 && positions.every((position, index) => position === index);

  const restoreInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreInput.fill(originalTitle);
  await restoreInput.press("Tab");
  await bob.page.getByLabel(`Title ${originalTitle}`).waitFor({ timeout: 30_000 });
  await admin("reset-order");

  await admin("revoke", "bob");
  await bob.page.locator('.app-shell[data-task-count="0"]').waitFor({ timeout: 30_000 });
  const revocationMarker = `Revoked marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(revocationMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await alice.page.getByLabel(`Title ${revocationMarker}`).waitFor({ timeout: 30_000 });
  await bob.page.waitForTimeout(750);
  const revokedFutureDelivery =
    (await bob.page.getByLabel(`Title ${revocationMarker}`).count()) > 0;
  await admin("provision", alice.userId, bob.userId);
  await bob.page.locator('.app-shell[data-task-count="101"]').waitFor({ timeout: 30_000 });
  await alice.page.getByRole("button", { name: `Delete ${revocationMarker}` }).click();
  await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });

  const retainedBefore = await bob.page.evaluate(async () => ({
    indexedDbNames: (await indexedDB.databases()).map((item) => item.name).filter(Boolean).sort(),
    localStorageKeys: Object.keys(localStorage).sort(),
  }));
  await bob.page.getByRole("button", { name: "Log out" }).click();
  await bob.page.getByTestId("guest-login").waitFor({ timeout: 30_000 });
  const retainedAfter = await bob.page.evaluate(async () => ({
    indexedDbNames: (await indexedDB.databases()).map((item) => item.name).filter(Boolean).sort(),
    localStorageKeys: Object.keys(localStorage).sort(),
  }));
  const sanitizeStoreInventory = (inventory) => ({
    indexedDbDatabaseCount: inventory.indexedDbNames.length,
    indexedDbNameHashes: inventory.indexedDbNames.map(hash).sort(),
    localStorageKeys: inventory.localStorageKeys,
  });
  const logoutMarker = `Logout marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(logoutMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await alice.page.getByLabel(`Title ${logoutMarker}`).waitFor({ timeout: 30_000 });
  await bob.page.waitForTimeout(750);
  const deliveryAfterLogout = (await bob.page.getByLabel(`Title ${logoutMarker}`).count()) > 0;
  await alice.page.getByRole("button", { name: `Delete ${logoutMarker}` }).click();
  await alice.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });

  const authority = await admin("summary");
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      realtimeTransportObserved &&
      conflictConverged &&
      concurrentOrderValid &&
      !revokedFutureDelivery &&
      !deliveryAfterLogout &&
      authority.taskCount === 100 &&
      authority.orderValid,
    crud: {
      editObservedBySecondClient: true,
      completeObservedBySecondClient: true,
      reopenObservedBySecondClient: true,
      reorderObservedBySecondClient: true,
      createAndDeleteObservedBySecondClient: true,
    },
    realtime: {
      secondClientPush: true,
      transport: "InstantDB native WebSocket live query",
      nativeWebSocketObserved: realtimeTransportObserved,
    },
    conflict: {
      policy:
        "whole-field last committed transaction wins; both optimistic clients reconcile to the authoritative server value",
      converged: conflictConverged,
      winningActorClass: authoritativeConflict.title === aliceConflict ? "alice" : "bob",
      authoritativeRevision: authoritativeConflict.revision,
    },
    concurrentOrder: {
      model: "atomic JSON taskOrder sequence owned by each list",
      positions,
      validUniquePermutation: concurrentOrderValid,
    },
    revocation: {
      connectedProtectedQueryCleared: true,
      futureWriteDelivered: revokedFutureDelivery,
      regrantRestoredAuthorizedQuery: true,
    },
    logout: {
      protectedUiRemoved: true,
      futureWriteDelivered: deliveryAfterLogout,
      retainedStoreInventoryBefore: sanitizeStoreInventory(retainedBefore),
      retainedStoreInventoryAfter: sanitizeStoreInventory(retainedAfter),
      valuesInspected: false,
    },
    authoritativeFinal: authority,
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/correctness-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await Promise.allSettled(opened.map((actor) => actor.context.close()));
  await admin("cleanup", "Realtime marker").catch(() => {});
  await admin("cleanup", "Revoked marker").catch(() => {});
  await admin("cleanup", "Logout marker").catch(() => {});
  await admin("reset-order").catch(() => {});
}
