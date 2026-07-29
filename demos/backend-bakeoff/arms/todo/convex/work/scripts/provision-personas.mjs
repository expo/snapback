#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const personas = ["alice", "bob", "mallory"];

await mkdir(runtimeRoot, { recursive: true });

async function openPersona(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    {
      executablePath: chromePath,
      headless: true,
      args: ["--disable-background-networking"],
    },
  );
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:4179/?persona=${persona}`);
  await page.locator(".app-shell").waitFor({ timeout: 20_000 });
  await page.locator('.app-shell[data-ready="true"]').waitFor({ timeout: 20_000 });
  const userId = await page.locator(".app-shell").getAttribute("data-user-id");
  if (!userId) throw new Error(`${persona} did not receive a Convex Auth user ID`);
  return { context, page, userId };
}

function runAdmin(action, ...subjects) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.resolve(workRoot, "scripts/admin-cli.mjs"), action, ...subjects],
      { cwd: workRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `admin helper exited ${code}`));
    });
  });
}

const opened = [];
try {
  for (const persona of personas) opened.push(await openPersona(persona));
  const secretPath = path.resolve(workRoot, ".arm-secrets.json");
  const secrets = JSON.parse(await readFile(secretPath, "utf8"));
  secrets.personas = Object.fromEntries(
    personas.map((persona, index) => [persona, opened[index].userId]),
  );
  await writeFile(secretPath, `${JSON.stringify(secrets)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(secretPath, 0o600);

  await runAdmin("provision", opened[0].userId, opened[1].userId);

  await opened[0].page
    .locator('.app-shell[data-task-count="100"]')
    .waitFor({ timeout: 20_000 });
  await opened[1].page
    .locator('.app-shell[data-task-count="100"]')
    .waitFor({ timeout: 20_000 });
  if ((await opened[2].page.locator(".app-shell").getAttribute("data-task-count")) !== "0") {
    throw new Error("Mallory received protected tasks");
  }

  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok: true,
    principalIdHashes: Object.fromEntries(
      personas.map((persona, index) => [persona, hash(opened[index].userId)]),
    ),
    authorizedTaskCounts: {
      alice: 100,
      bob: 100,
      mallory: 0,
    },
    identityClass: "Convex Auth anonymous provider users",
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/personas.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await Promise.all(opened.map(({ context }) => context.close()));
}
