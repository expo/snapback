#!/usr/bin/env node

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

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? (await context.newPage());
  const sockets = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto(`http://127.0.0.1:4179/?persona=${persona}`);
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 20_000 });
  const shell = page.locator(".app-shell");
  const userId = await shell.getAttribute("data-user-id");
  if (
    !userId ||
    createHash("sha256").update(userId).digest("hex") !== expectedHashes[persona]
  ) {
    throw new Error(`${persona} identity changed`);
  }
  return { persona, context, page, sockets };
}

try {
  for (const persona of ["alice", "bob", "mallory"]) {
    opened.push(await openPersona(persona));
  }
  const [alice, bob, mallory] = opened;
  const count = async (actor) =>
    Number(await actor.page.locator(".app-shell").getAttribute("data-task-count"));
  if ((await count(alice)) !== 100 || (await count(bob)) !== 100) {
    throw new Error("members did not receive the deterministic dataset");
  }
  if ((await count(mallory)) !== 0) throw new Error("Mallory received protected rows");

  const marker = `Realtime marker ${Date.now()}`;
  await alice.page.getByLabel("New task").fill(marker);
  await alice.page.getByRole("button", { name: "Add", exact: true }).click();
  await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 20_000 });
  const bobSawInsert = (await count(bob)) === 101;
  await alice.page.getByRole("button", { name: `Delete ${marker}` }).click();
  await bob.page
    .getByLabel(`Title ${marker}`)
    .waitFor({ state: "detached", timeout: 20_000 });
  const bobSawDelete = (await count(bob)) === 100;

  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok:
      bobSawInsert &&
      bobSawDelete &&
      opened.every(({ sockets }) =>
        sockets.some((url) => url.startsWith("ws://127.0.0.1:3210")),
      ),
    authorizedTaskCounts: {
      alice: await count(alice),
      bob: await count(bob),
      mallory: await count(mallory),
    },
    identityHashesStable: true,
    bobSawInsert,
    bobSawDelete,
    transport: "Convex WebSocket reactive query",
    eachClientOpenedNativeWebSocket: opened.every(({ sockets }) =>
      sockets.some((url) => url.startsWith("ws://127.0.0.1:3210")),
    ),
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/browser-smoke.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await Promise.all(opened.map(({ context }) => context.close()));
}
