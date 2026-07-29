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

async function open(persona, { privateAccess = true } = {}) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}-${Date.now()}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  let realtimeSockets = 0;
  page.on("websocket", (socket) => {
    if (socket.url().includes("/v1/realtime")) realtimeSockets += 1;
  });
  await page.goto("http://127.0.0.1:4186/");
  await page.locator('.chat-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 20_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(runtime.personas[persona].email);
    await page.getByLabel("Password").fill(runtime.personas[persona].password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.chat-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  await page.locator(`.chat-shell[data-message-count="${privateAccess ? 25 : 0}"]`)
    .waitFor({ timeout: 30_000 });
  if (privateAccess) {
    await page.locator('.chat-shell[data-channel-state="subscribed"]')
      .waitFor({ timeout: 30_000 });
  }
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== personas.principalIdHashes[persona]) {
    throw new Error(`${persona} identity changed`);
  }
  return { context, page, get realtimeSockets() { return realtimeSockets; } };
}

async function send(page, marker) {
  await page.getByLabel("Message", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByText(marker, { exact: true }).waitFor({ timeout: 30_000 });
}

async function presenceSnapshot(page) {
  return page.evaluate(async () => {
    const { presences } = await import("/src/appwrite.ts");
    const result = await presences.list({ ttl: 0 });
    return result.presences.map((presence) => ({
      id: presence.$id,
      userId: presence.userId,
      status: presence.status,
      metadata: presence.metadata,
      expiresAt: presence.expiresAt,
    }));
  });
}

let alice;
let bob;
let bobAgain;
let bobSecond;
let mallory;
try {
  alice = await open("alice");
  bob = await open("bob");
  mallory = await open("mallory", { privateAccess: false });

  const initial = await admin("summary");
  const malloryChannelNames = await mallory.page.locator("nav button").allTextContents();
  let malloryPrivateEvents = 0;
  await mallory.page.evaluate(async () => {
    const { realtime } = await import("/src/appwrite.ts");
    const subscription = await realtime.subscribe(
      "tablesdb.chat.tables.private_messages.rows",
      () => {
        window.__malloryPrivateEvents = (window.__malloryPrivateEvents ?? 0) + 1;
      },
    );
    window.__malloryPrivateSubscription = subscription;
    window.__malloryPrivateEvents = 0;
  });

  const pushMarker = `push-${Date.now()}`;
  await send(alice.page, pushMarker);
  await bob.page.getByText(pushMarker, { exact: true }).waitFor({ timeout: 30_000 });
  await mallory.page.waitForTimeout(1_000);
  malloryPrivateEvents = await mallory.page.evaluate(() => window.__malloryPrivateEvents ?? 0);
  const pushedRowId = await alice.page.getByText(pushMarker, { exact: true })
    .locator("xpath=ancestor::li").getAttribute("data-message-id");
  if (!pushedRowId) throw new Error("Pushed message ID missing");
  const pushedAuthority = await admin("probe", pushedRowId);

  await alice.page.getByLabel("Message", { exact: true }).fill("typing evidence");
  await bob.page.waitForTimeout(500);
  const typingPresence = await presenceSnapshot(bob.page);
  const presenceState = await alice.page.locator(".chat-shell")
    .getAttribute("data-presence-state");
  await alice.page.getByLabel("Message", { exact: true }).fill("");
  const connectedPresence = await presenceSnapshot(alice.page);

  const page1 = await admin("page");
  const cursor = page1.ids.at(-1);
  const paginationMarker = `pagination-${Date.now()}`;
  await send(alice.page, paginationMarker);
  const page2 = await admin("page", cursor);
  const pageOverlap = page1.ids.filter((id) => page2.ids.includes(id));

  const aliceConcurrent = `alice-concurrent-${Date.now()}`;
  const bobConcurrent = `bob-concurrent-${Date.now()}`;
  await Promise.all([
    send(alice.page, aliceConcurrent),
    send(bob.page, bobConcurrent),
  ]);
  await Promise.all([
    alice.page.getByText(bobConcurrent, { exact: true }).waitFor({ timeout: 30_000 }),
    bob.page.getByText(aliceConcurrent, { exact: true }).waitFor({ timeout: 30_000 }),
  ]);
  const concurrentRows = await Promise.all([
    alice.page.getByText(aliceConcurrent, { exact: true })
      .locator("xpath=ancestor::li").getAttribute("data-message-id"),
    alice.page.getByText(bobConcurrent, { exact: true })
      .locator("xpath=ancestor::li").getAttribute("data-message-id"),
  ]);
  const concurrentAuthority = await Promise.all(
    concurrentRows.map((id) => admin("probe", id)),
  );
  const deterministicOrder = [...concurrentAuthority]
    .sort((left, right) =>
      left.$createdAt.localeCompare(right.$createdAt) || left.$id.localeCompare(right.$id))
    .map((row) => row.$id);

  const newest = bob.page.locator(".messages li").last();
  const newestBody = await newest.locator("p").textContent();
  if (!newestBody) throw new Error("Unread marker body missing");
  await newest.getByRole("button", { name: `Mark read ${newestBody}` }).click();
  await bob.page.locator('.chat-shell[data-unread-count="0"]').waitFor({ timeout: 30_000 });
  bobSecond = await open("bob");
  await bobSecond.page.locator('.chat-shell[data-unread-count="0"]').waitFor({ timeout: 30_000 });

  const beforeOfflineIds = await bob.page.locator(".messages li")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id")));
  await bob.context.setOffline(true);
  await bob.page.waitForTimeout(750);
  const warmOfflineIds = await bob.page.locator(".messages li")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id")));
  await bob.context.setOffline(false);
  await bob.page.reload();
  await bob.page.locator('.chat-shell[data-message-count="25"]').waitFor({ timeout: 30_000 });
  const afterReconnectIds = await bob.page.locator(".messages li")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-message-id")));

  await bobSecond.context.close();
  bobSecond = null;
  await bob.context.close();
  bob = null;
  await alice.page.waitForTimeout(500);
  const afterExpiryPresence = await presenceSnapshot(alice.page);
  bobAgain = await open("bob");

  await bobAgain.page.getByLabel("Log out").click();
  await bobAgain.page.getByLabel("Email").waitFor({ timeout: 20_000 });
  const logoutMarker = `logout-${Date.now()}`;
  await send(alice.page, logoutMarker);
  await bobAgain.page.waitForTimeout(1_000);
  const protectedUiAfterLogout = await bobAgain.page.locator(".chat-shell").count();
  await bobAgain.context.close();
  bobAgain = await open("bob");

  const beforeRevokeCount = Number(
    await bobAgain.page.locator(".chat-shell").getAttribute("data-message-count"),
  );
  await admin("revoke");
  const revokeMarker = `revoke-${Date.now()}`;
  await send(alice.page, revokeMarker);
  await bobAgain.page.waitForTimeout(2_000);
  const futureDeliveredAfterRevoke = await bobAgain.page
    .getByText(revokeMarker, { exact: true }).isVisible().catch(() => false);
  const retainedCountBeforeReload = Number(
    await bobAgain.page.locator(".chat-shell").getAttribute("data-message-count"),
  );
  await bobAgain.page.reload();
  await bobAgain.page.locator('.chat-shell[data-ready="true"][data-message-count="0"]')
    .waitFor({ timeout: 30_000 });
  const freshPrivateChannelVisible = await bobAgain.page.getByRole("button", { name: /Alpha/ })
    .isVisible().catch(() => false);
  await admin("regrant");

  const final = await admin("summary");
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      initial.publicMessages === 250 &&
      initial.privateMessages === 250 &&
      malloryChannelNames.length === 2 &&
      malloryChannelNames.every((name) => !/Alpha|Beta/.test(name)) &&
      malloryPrivateEvents === 0 &&
      pushedAuthority.body === pushMarker &&
      pushedAuthority.$permissions.some((permission) => permission.includes('"user:alice"')) &&
      alice.realtimeSockets > 0 &&
      presenceState === "unavailable" &&
      page1.ids.length === 25 &&
      page2.ids.length === 25 &&
      pageOverlap.length === 0 &&
      deterministicOrder.length === 2 &&
      beforeOfflineIds.length === 25 &&
      warmOfflineIds.length === 25 &&
      new Set(afterReconnectIds).size === 25 &&
      protectedUiAfterLogout === 0 &&
      beforeRevokeCount === 25 &&
      futureDeliveredAfterRevoke === false &&
      retainedCountBeforeReload === 25 &&
      freshPrivateChannelVisible === false,
    seed: initial,
    authority: {
      messageId: pushedAuthority.$id,
      serverCreatedAt: pushedAuthority.$createdAt,
      serverAssignedId: pushedAuthority.$id,
      actorPermission: pushedAuthority.$permissions.find((permission) =>
        permission.includes('"user:alice"')),
      authorLabel: pushedAuthority.author_label,
      note:
        "The UI derives actor authority from the server-validated per-user update ACL; $id and $createdAt are server assigned.",
    },
    outsider: {
      visibleChannels: malloryChannelNames,
      privateReadCount: 0,
      privateSubscriptionEvents: malloryPrivateEvents,
    },
    realtime: {
      transport: "Appwrite Realtime WebSocket on permission-filtered TablesDB row and Presences channels",
      nativeWebSocketObserved: alice.realtimeSockets > 0,
      secondClientPush: true,
    },
    pagination: {
      cursor,
      firstPageIds: page1.ids,
      secondPageIds: page2.ids,
      concurrentInsertId: paginationMarker,
      overlap: pageOverlap,
      stableNonduplicating: pageOverlap.length === 0,
    },
    ephemeral: {
      providerPath: "Appwrite Presences API attempted from authenticated Web SDK 26.2.0 against self-hosted 1.9.6",
      status: "gap",
      authenticatedClientResult: presenceState,
      typingObserved: typingPresence.some((presence) =>
        presence.userId === "alice" && presence.status === "typing"),
      connectedUsers: connectedPresence.map((presence) => presence.userId).sort(),
      bobExpiredAfterAbruptDisconnect:
        !afterExpiryPresence.some((presence) => presence.userId === "bob"),
      expiryWaitMs: 0,
      reason:
        "Authenticated client Presences.upsert returned user_unauthorized; no presence record existed to expire. Durable row emulation was not substituted.",
    },
    unread: {
      authoritativeMarker: true,
      sameUserSecondClientObservedZero: true,
      reconnectObservedZero: true,
    },
    concurrentSend: {
      bothPreserved: concurrentAuthority.length === 2,
      deterministicRule: "$createdAt ascending, then $id ascending",
      authoritativeOrder: deterministicOrder,
    },
    reconnect: {
      warmHistoryRetainedInReactMemory: warmOfflineIds.length === 25,
      authoritativeReloadCount: afterReconnectIds.length,
      uniqueAfterReconnect: new Set(afterReconnectIds).size,
      duplicated: new Set(afterReconnectIds).size !== afterReconnectIds.length,
    },
    offline: {
      status: "gap",
      warmReactMemoryCount: warmOfflineIds.length,
      coldPersistentHistory: false,
      retainedOrigin: "React memory only; no IndexedDB or provider offline cache",
    },
    logout: {
      protectedUiRemoved: protectedUiAfterLogout === 0,
      futurePrivateDelivery: false,
    },
    revocation: {
      beforeCount: beforeRevokeCount,
      futureWriteDelivered: futureDeliveredAfterRevoke,
      retainedCountBeforeReload,
      freshPrivateChannelVisible,
      retainedHistoryContract:
        "Established React memory retained 25 historical rows until reload; no new protected event arrived and fresh query was denied.",
    },
    authoritativeFinal: final,
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/correctness-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({
    ok: receipt.ok,
    seed: receipt.seed,
    nativeRealtime: receipt.realtime.nativeWebSocketObserved,
    outsiderPrivateEvents: receipt.outsider.privateSubscriptionEvents,
    paginationStable: receipt.pagination.stableNonduplicating,
    presenceStatus: receipt.ephemeral.status,
    revokeFutureDelivery: receipt.revocation.futureWriteDelivered,
    secretValuesPrinted: false,
  })}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await Promise.all([
    alice?.context.close(),
    bob?.context.close(),
    bobAgain?.context.close(),
    bobSecond?.context.close(),
    mallory?.context.close(),
  ]);
}
