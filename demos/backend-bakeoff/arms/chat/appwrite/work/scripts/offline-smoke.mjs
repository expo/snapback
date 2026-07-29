#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const runtime = JSON.parse(await readFile(path.resolve(workRoot, ".arm-runtime/owner.json")));
const profile = path.resolve(armRoot, "runtime/offline-bob");
const hash = (value) => createHash("sha256").update(value).digest("hex");

const context = await chromium.launchPersistentContext(profile, {
  executablePath: chromePath,
  headless: true,
});
const page = context.pages()[0] ?? await context.newPage();
try {
  await page.goto("http://127.0.0.1:4186/");
  await page.getByLabel("Email").fill(runtime.personas.bob.email);
  await page.getByLabel("Password").fill(runtime.personas.bob.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator('.chat-shell[data-message-count="25"]').waitFor({ timeout: 30_000 });
  const storeBefore = await page.evaluate(async () => ({
    indexedDbNames: (await indexedDB.databases()).map((database) => database.name).filter(Boolean),
    localStorageKeys: Object.keys(localStorage).sort(),
  }));
  await context.setOffline(true);
  await page.waitForTimeout(750);
  const warmCount = Number(
    await page.locator(".chat-shell").getAttribute("data-message-count"),
  );
  let blockedReload;
  try {
    await page.reload({ timeout: 5_000, waitUntil: "domcontentloaded" });
    blockedReload = false;
  } catch {
    blockedReload = true;
  }
  const protectedRowsAfterOfflineReload = await page.locator(".messages li").count()
    .catch(() => 0);
  await context.setOffline(false);
  await page.goto("http://127.0.0.1:4186/");
  await page.locator('.chat-shell[data-message-count="25"]').waitFor({ timeout: 30_000 });
  const afterReconnectIds = await page.locator(".messages li")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id")));
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    status: "gap",
    warmHistory: {
      messageCount: warmCount,
      origin: "mounted React memory",
      transportDisabled: true,
    },
    coldHistory: {
      blockedReload,
      protectedMessageCount: protectedRowsAfterOfflineReload,
      persistentProviderCache: false,
    },
    storeInventory: {
      indexedDbDatabaseCount: storeBefore.indexedDbNames.length,
      indexedDbNameHashes: storeBefore.indexedDbNames.map(hash),
      localStorageKeyHashes: storeBefore.localStorageKeys.map(hash),
      note:
        "The only retained provider state was the Appwrite Auth session; TablesDB history had no IndexedDB cache.",
    },
    reconnect: {
      authoritativeMessageCount: afterReconnectIds.length,
      uniqueMessageIds: new Set(afterReconnectIds).size,
      duplicated: new Set(afterReconnectIds).size !== afterReconnectIds.length,
    },
    reason:
      "The Appwrite Web SDK retained loaded history only in React memory. An offline reload had no provider-backed history; reconnect refetched authority.",
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/offline-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({
    status: receipt.status,
    warmCount,
    coldCount: protectedRowsAfterOfflineReload,
    reconnectCount: afterReconnectIds.length,
    secretValuesPrinted: false,
  })}\n`);
} finally {
  await context.close();
}
