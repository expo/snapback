#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
  if (!userId) throw new Error(`${persona} has no native user ID`);
  return { persona, context, page, sockets, userId };
}

const first = [];
const second = [];
try {
  for (const persona of ["alice", "bob", "mallory"]) {
    first.push(await openPersona(persona));
  }
  const [alice, bob, mallory] = first;
  const seeded = await admin("provision", alice.userId, bob.userId);
  await alice.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await mallory.page.locator('.app-shell[data-task-count="0"]').waitFor({ timeout: 30_000 });

  const principalIdHashes = Object.fromEntries(
    first.map((actor) => [actor.persona, hash(actor.userId)]),
  );
  await Promise.all(first.map((actor) => actor.context.close()));
  first.length = 0;

  for (const persona of ["alice", "bob", "mallory"]) {
    second.push(await openPersona(persona));
  }
  const reopenedHashes = Object.fromEntries(
    second.map((actor) => [actor.persona, hash(actor.userId)]),
  );
  const identityHashesStable = Object.entries(principalIdHashes)
    .every(([persona, value]) => reopenedHashes[persona] === value);
  const taskCounts = Object.fromEntries(
    await Promise.all(second.map(async (actor) => [
      actor.persona,
      Number(await actor.page.locator(".app-shell").getAttribute("data-task-count")),
    ])),
  );
  const eachClientOpenedNativeWebSocket = second.every((actor) =>
    actor.sockets.some((url) => url.startsWith("ws://127.0.0.1:8889/runtime/session")),
  );
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      identityHashesStable &&
      taskCounts.alice === 100 &&
      taskCounts.bob === 100 &&
      taskCounts.mallory === 0 &&
      seeded.workspaceCount === 1 &&
      seeded.membershipCount === 2 &&
      seeded.listCount === 4 &&
      seeded.taskCount === 100 &&
      seeded.uniqueTaskIds === 100 &&
      seeded.listOrderLengths.every((count) => count === 25) &&
      eachClientOpenedNativeWebSocket,
    principalIdHashes,
    identityHashesStable,
    authorizedTaskCounts: taskCounts,
    authoritativeSeed: seeded,
    transport: "InstantDB native WebSocket live query",
    eachClientOpenedNativeWebSocket,
    outsider: {
      nativeAuthenticated: true,
      protectedRows: taskCounts.mallory,
      protectedRowsRetained: false,
    },
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/personas.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await Promise.allSettled([
    ...first.map((actor) => actor.context.close()),
    ...second.map((actor) => actor.context.close()),
  ]);
}
