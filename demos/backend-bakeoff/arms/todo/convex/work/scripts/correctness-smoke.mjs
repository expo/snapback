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
const secretsPath = path.resolve(workRoot, ".arm-secrets.json");
const opened = [];

function admin(action, ...subjects) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(workRoot, "scripts/admin-cli.mjs"), action, ...subjects],
      { cwd: workRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `admin helper exited ${code}`));
    });
  });
}

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:4179/?persona=${persona}`);
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 20_000 });
  await page.locator("li").first().waitFor({ timeout: 20_000 });
  return { persona, context, page };
}

const count = async (actor) =>
  Number(await actor.page.locator(".app-shell").getAttribute("data-task-count"));

try {
  const secrets = JSON.parse(await readFile(secretsPath, "utf8"));
  for (const persona of ["alice", "bob"]) opened.push(await openPersona(persona));
  const [alice, bob] = opened;
  if ((await count(alice)) !== 100 || (await count(bob)) !== 100) {
    throw new Error("member baseline is not 100 tasks");
  }

  const first = alice.page.locator("li").first();
  const taskId = await first.getAttribute("data-task-id");
  if (!taskId) throw new Error("first task has no ID");
  const originalTitle = await first
    .locator('input:not([type="checkbox"])')
    .inputValue();
  const restoreTitle = originalTitle.startsWith("Task ") ? originalTitle : "Task 001";
  const editedTitle = `Edited ${Date.now()}`;
  await first.locator('input:not([type="checkbox"])').fill(editedTitle);
  await first.locator('input:not([type="checkbox"])').press("Tab");
  await bob.page.getByLabel(`Title ${editedTitle}`).waitFor({ timeout: 20_000 });
  const editObservedBySecondClient = true;

  await alice.page
    .locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`)
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-completed="true"]`)
    .waitFor({ timeout: 20_000 });
  const completeObservedBySecondClient = true;
  await alice.page
    .locator(`li[data-task-id="${taskId}"] input[type="checkbox"]`)
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-completed="false"]`)
    .waitFor({ timeout: 20_000 });
  const reopenObservedBySecondClient = true;

  await alice.page
    .locator(`li[data-task-id="${taskId}"]`)
    .getByRole("button", { name: `Move ${editedTitle} down` })
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-position="1"]`)
    .waitFor({ timeout: 20_000 });
  await alice.page
    .locator(`li[data-task-id="${taskId}"]`)
    .getByRole("button", { name: `Move ${editedTitle} up` })
    .click();
  await bob.page
    .locator(`li[data-task-id="${taskId}"][data-position="0"]`)
    .waitFor({ timeout: 20_000 });
  const moveDownAndRestorePreservedUniqueOrder = true;

  const crudMarker = `Correctness marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(crudMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await bob.page.getByLabel(`Title ${crudMarker}`).waitFor({ timeout: 20_000 });
  await alice.page.getByRole("button", { name: `Delete ${crudMarker}` }).click();
  await bob.page
    .getByLabel(`Title ${crudMarker}`)
    .waitFor({ state: "detached", timeout: 20_000 });
  const createAndDeleteObservedBySecondClient = true;

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
  await alice.page.waitForTimeout(500);
  const authoritativeConflict = JSON.parse(await admin("probe", taskId));
  await alice.page
    .getByLabel(`Title ${authoritativeConflict.title}`)
    .waitFor({ timeout: 20_000 });
  await bob.page
    .getByLabel(`Title ${authoritativeConflict.title}`)
    .waitFor({ timeout: 20_000 });
  const conflictConverged =
    authoritativeConflict.title === aliceConflict ||
    authoritativeConflict.title === bobConflict;

  const firstId = await alice.page.locator("li").first().getAttribute("data-task-id");
  const lastId = await bob.page.locator("li").last().getAttribute("data-task-id");
  if (!firstId || !lastId) throw new Error("order barrier tasks missing");
  await Promise.all([
    alice.page
      .locator(`li[data-task-id="${firstId}"]`)
      .getByRole("button", { name: / down$/ })
      .click(),
    bob.page
      .locator(`li[data-task-id="${lastId}"]`)
      .getByRole("button", { name: / up$/ })
      .click(),
  ]);
  await alice.page.waitForTimeout(500);
  const positions = await alice.page
    .locator("li")
    .evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute("data-position"))).sort((a, b) => a - b),
    );
  const concurrentOrderValid =
    positions.length === 25 && positions.every((position, index) => position === index);

  const restoreInput = alice.page.locator(
    `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
  );
  await restoreInput.fill(restoreTitle);
  await restoreInput.press("Tab");
  await bob.page.getByLabel(`Title ${restoreTitle}`).waitFor({ timeout: 20_000 });

  await admin("revoke", secrets.personas.bob);
  await bob.page
    .locator('.app-shell[data-task-count="0"]')
    .waitFor({ timeout: 20_000 });
  const revocationMarker = `Revoked marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(revocationMarker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await alice.page.getByLabel(`Title ${revocationMarker}`).waitFor({ timeout: 20_000 });
  await bob.page.waitForTimeout(500);
  const futureWriteDelivered =
    (await bob.page.getByLabel(`Title ${revocationMarker}`).count()) > 0;
  await admin(
    "provision",
    secrets.personas.alice,
    secrets.personas.bob,
  );
  await bob.page
    .locator('.app-shell[data-task-count="101"]')
    .waitFor({ timeout: 20_000 });
  await alice.page.getByRole("button", { name: `Delete ${revocationMarker}` }).click();
  await bob.page
    .locator('.app-shell[data-task-count="100"]')
    .waitFor({ timeout: 20_000 });

  const bobBeforeLogout = await bob.page
    .locator(".app-shell")
    .getAttribute("data-user-id");
  await bob.page.getByRole("button", { name: "Log out" }).click();
  await bob.page.locator(".app-shell").waitFor({ timeout: 20_000 });
  await bob.page
    .locator('.app-shell[data-ready="true"][data-task-count="0"]')
    .waitFor({ timeout: 20_000 });
  const bobAfterLogout = await bob.page
    .locator(".app-shell")
    .getAttribute("data-user-id");
  const logoutCreatedFreshUnprivilegedIdentity =
    Boolean(bobBeforeLogout && bobAfterLogout && bobBeforeLogout !== bobAfterLogout);

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      editObservedBySecondClient &&
      completeObservedBySecondClient &&
      reopenObservedBySecondClient &&
      moveDownAndRestorePreservedUniqueOrder &&
      createAndDeleteObservedBySecondClient &&
      conflictConverged &&
      concurrentOrderValid &&
      !futureWriteDelivered &&
      logoutCreatedFreshUnprivilegedIdentity,
    crud: {
      editObservedBySecondClient,
      completeObservedBySecondClient,
      reopenObservedBySecondClient,
      moveDownAndRestorePreservedUniqueOrder,
      createAndDeleteObservedBySecondClient,
    },
    conflict: {
      policy: "serializable optimistic concurrency with the last committed mutation visible",
      converged: conflictConverged,
      winningActorClass:
        authoritativeConflict.title === aliceConflict ? "alice" : "bob",
      authoritativeRevision: authoritativeConflict.revision,
    },
    concurrentOrder: { positions, validUniquePermutation: concurrentOrderValid },
    revocation: {
      connectedCacheCleared: true,
      futureWriteDelivered,
      regrantRestoredAuthorizedQuery: true,
    },
    logout: {
      protectedCacheCleared: true,
      freshUnprivilegedIdentity: logoutCreatedFreshUnprivilegedIdentity,
    },
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

  await admin("cleanup", "Correctness marker");
  await admin("cleanup", "Revoked marker");
} finally {
  await Promise.all(opened.map(({ context }) => context.close()));
}
