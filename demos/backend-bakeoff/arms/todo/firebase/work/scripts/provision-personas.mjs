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

const hash = (value) => createHash("sha256").update(value).digest("hex");
async function openPersona(persona, expectedHash) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  const firestoreRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("127.0.0.1:8085")) firestoreRequests.push(request.url());
  });
  await page.goto(`http://127.0.0.1:4181/?persona=${persona}`);
  await page.locator('.app-shell, input[aria-label="Email"]').first()
    .waitFor({ timeout: 15_000 });
  if (await page.getByLabel("Email").isVisible().catch(() => false)) {
    await page.getByLabel("Email").fill(credentials[persona][0]);
    await page.getByLabel("Password").fill(credentials[persona][1]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  const userId = await shell.getAttribute("data-user-id");
  if (!userId || hash(userId) !== expectedHash) throw new Error(`${persona} identity changed`);
  return { persona, context, page, firestoreRequests, userId };
}

const seeded = await admin("seed");
const first = [];
const second = [];
try {
  for (const persona of ["alice", "bob", "mallory"]) {
    first.push(await openPersona(persona, seeded.principalIdHashes[persona]));
  }
  await first[0].page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await first[1].page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });
  await first[2].page.locator('.app-shell[data-task-count="0"]').waitFor({ timeout: 30_000 });
  await Promise.all(first.map((actor) => actor.context.close()));
  first.length = 0;

  for (const persona of ["alice", "bob", "mallory"]) {
    second.push(await openPersona(persona, seeded.principalIdHashes[persona]));
  }
  const taskCounts = Object.fromEntries(
    await Promise.all(second.map(async (actor) => [
      actor.persona,
      Number(await actor.page.locator(".app-shell").getAttribute("data-task-count")),
    ])),
  );
  const identityHashesStable = second.every(
    (actor) => hash(actor.userId) === seeded.principalIdHashes[actor.persona],
  );
  const eachClientOpenedNativeListenChannel = second.every((actor) =>
    actor.firestoreRequests.some((url) => /Listen\/channel/.test(url)),
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
      seeded.taskCount === 100,
    principalIdHashes: seeded.principalIdHashes,
    identityHashesStable,
    authorizedTaskCounts: taskCounts,
    authoritativeSeed: seeded,
    transport: "Cloud Firestore WebChannel listen stream",
    eachClientOpenedNativeListenChannel,
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
