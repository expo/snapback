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
const personas = JSON.parse(await readFile(path.resolve(armRoot, "receipts/personas.v1.json")));
const env = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
const credentials = {
  alice: [env.ALICE_EMAIL, env.ALICE_PASSWORD],
  bob: [env.BOB_EMAIL, env.BOB_PASSWORD],
  mallory: [env.MALLORY_EMAIL, env.MALLORY_PASSWORD],
};
const opened = [];
const hash = (value) => createHash("sha256").update(value).digest("hex");

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

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  const channels = [];
  page.on("request", (request) => {
    if (/127\.0\.0\.1:8085.*Listen\/channel/.test(request.url())) channels.push(request.url());
  });
  await page.goto(`http://127.0.0.1:4181/?persona=${persona}`);
  await page.locator('.app-shell, input[aria-label="Email"]').first().waitFor({ timeout: 15_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(credentials[persona][0]);
    await page.getByLabel("Password").fill(credentials[persona][1]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== personas.principalIdHashes[persona]) {
    throw new Error(`${persona} identity changed`);
  }
  return { persona, context, page, channels };
}

const count = async (actor) =>
  Number(await actor.page.locator(".app-shell").getAttribute("data-task-count"));

try {
  for (const persona of ["alice", "bob", "mallory"]) opened.push(await openPersona(persona));
  const [alice, bob, mallory] = opened;
  if ((await count(alice)) !== 100 || (await count(bob)) !== 100 || (await count(mallory)) !== 0) {
    throw new Error("authorization baseline drifted");
  }
  const first = alice.page.locator(".task-row").first();
  const taskId = await first.getAttribute("data-task-id");
  const originalTitle = await first.locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("first task ID missing");

  const editedTitle = `Edited ${Date.now()}`;
  await first.locator('input:not([type="checkbox"])').fill(editedTitle);
  await first.locator('input:not([type="checkbox"])').press("Tab");
  await bob.page.getByLabel(`Title ${editedTitle}`).waitFor({ timeout: 30_000 });
  await alice.page.locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`).click();
  await bob.page.locator(`li[data-task-id="${taskId}"][data-completed="true"]`).waitFor({ timeout: 30_000 });
  await alice.page.locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`).click();
  await bob.page.locator(`li[data-task-id="${taskId}"][data-completed="false"]`).waitFor({ timeout: 30_000 });
  await alice.page.locator(`li[data-task-id="${taskId}"]`).getByRole("button", { name: `Move ${editedTitle} down` }).click();
  await bob.page.locator(`li[data-task-id="${taskId}"][data-position="1"]`).waitFor({ timeout: 30_000 });
  await alice.page.locator(`li[data-task-id="${taskId}"]`).getByRole("button", { name: `Move ${editedTitle} up` }).click();
  await bob.page.locator(`li[data-task-id="${taskId}"][data-position="0"]`).waitFor({ timeout: 30_000 });

  const marker = `Realtime marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(marker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
  const nativeListenObserved = bob.channels.length > 0;
  await alice.page.getByRole("button", { name: `Delete ${marker}` }).click();
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ state: "detached", timeout: 30_000 });

  const aliceConflict = `Alice conflict ${Date.now()}`;
  const bobConflict = `Bob conflict ${Date.now()}`;
  const aliceInput = alice.page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
  const bobInput = bob.page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
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
  const restore = alice.page.locator(`li[data-task-id="${taskId}"] input:not([type="checkbox"])`);
  await restore.fill(originalTitle);
  await restore.press("Tab");
  await bob.page.getByLabel(`Title ${originalTitle}`).waitFor({ timeout: 30_000 });
  await admin("reset-order");

  await admin("revoke", "bob");
  const clearedBeforeNextWrite = await bob.page.locator('.app-shell[data-task-count="0"]')
    .waitFor({ timeout: 3_000 }).then(() => true).catch(() => false);
  const revokedMarker = `Revoked marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(revokedMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await alice.page.getByLabel(`Title ${revokedMarker}`).waitFor({ timeout: 30_000 });
  await bob.page.waitForTimeout(1500);
  const revokedFutureDelivery = (await bob.page.getByLabel(`Title ${revokedMarker}`).count()) > 0;
  const clearedAfterNextWrite =
    Number(await bob.page.locator(".app-shell").getAttribute("data-task-count")) === 0;
  await admin("regrant", "bob");
  await bob.page.reload();
  await bob.page.locator('.app-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 15_000 });
  if (await bob.page.getByLabel("Email").isVisible().catch(() => false)) {
    await bob.page.getByLabel("Email").fill(credentials.bob[0]);
    await bob.page.getByLabel("Password").fill(credentials.bob[1]);
    await bob.page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await bob.page.locator('.app-shell[data-task-count="101"]').waitFor({ timeout: 30_000 });
  await alice.page.getByRole("button", { name: `Delete ${revokedMarker}` }).click();
  await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });

  const retainedBefore = await bob.page.evaluate(async () =>
    (await indexedDB.databases()).map((item) => item.name).filter(Boolean).sort()
  );
  await bob.page.getByRole("button", { name: "Log out" }).click();
  await bob.page.getByLabel("Email").waitFor({ timeout: 30_000 });
  const retainedAfter = await bob.page.evaluate(async () =>
    (await indexedDB.databases()).map((item) => item.name).filter(Boolean).sort()
  );
  const logoutMarker = `Logout marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(logoutMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await alice.page.getByLabel(`Title ${logoutMarker}`).waitFor({ timeout: 30_000 });
  await bob.page.waitForTimeout(1000);
  const deliveryAfterLogout = (await bob.page.getByLabel(`Title ${logoutMarker}`).count()) > 0;
  await alice.page.getByRole("button", { name: `Delete ${logoutMarker}` }).click();
  await alice.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });

  const authority = await admin("summary");
  const sanitize = (names) => ({
    indexedDbDatabaseCount: names.length,
    indexedDbNameHashes: names.map(hash).sort(),
  });
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      nativeListenObserved &&
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
      transport: "Cloud Firestore WebChannel listen stream",
      nativeListenObserved,
      secondClientPush: true,
    },
    conflict: {
      policy: "last server commit wins for the title field; listeners reconcile optimistic state",
      converged: conflictConverged,
      winningActorClass: authoritativeConflict.title === aliceConflict ? "alice" : "bob",
      authoritativeRevision: authoritativeConflict.revision,
    },
    concurrentOrder: { positions, validUniquePermutation: concurrentOrderValid },
    revocation: {
      cacheClearedImmediately: clearedBeforeNextWrite,
      cacheClearedAfterNextWrite: clearedAfterNextWrite,
      futureWriteDelivered: revokedFutureDelivery,
      regrantRestoredQueryAfterReload: true,
    },
    logout: {
      protectedUiRemoved: true,
      futureWriteDelivered: deliveryAfterLogout,
      retainedStoreInventoryBefore: sanitize(retainedBefore),
      retainedStoreInventoryAfter: sanitize(retainedAfter),
      protectedValuesInspected: false,
      contract:
        "Firestore persistent cache is device-local and is not automatically erased by Firebase Auth sign-out.",
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
  await admin("regrant", "bob").catch(() => {});
}
