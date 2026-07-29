#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const runtimeRoot = path.resolve(armRoot, "runtime");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const warmups = 2;
const recordedSamples = 7;
const totalSamples = warmups + recordedSamples;
const armEnv = Object.fromEntries(
  (await readFile(path.resolve(workRoot, ".arm-secrets"), "utf8"))
    .trim().split("\n").map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);

function command(commandName, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: workRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr || `${commandName} exited ${code}`));
    });
  });
}

async function admin(...args) {
  return JSON.parse(await command(process.execPath, [
    path.resolve(workRoot, "scripts/admin-cli.mjs"),
    ...args,
  ]));
}

async function timed(operation) {
  const started = performance.now();
  await operation();
  return Number((performance.now() - started).toFixed(3));
}

async function open(profile, expectedCount) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, profile),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(`http://127.0.0.1:4180/?persona=${profile}`);
  const shell = page.locator('.app-shell[data-ready="true"]');
  await shell.waitFor({ timeout: 30_000 });
  if (expectedCount !== undefined) {
    await page.locator(`.app-shell[data-task-count="${expectedCount}"]`)
      .waitFor({ timeout: 30_000 });
  }
  return {
    context,
    page,
    userId: await shell.getAttribute("data-user-id"),
  };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    rawMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
}

let alice = await open("chrome-alice", 100);
let bob = await open("chrome-performance-bob");
if (!alice.userId || !bob.userId) throw new Error("performance personas missing");
await admin("provision", alice.userId, bob.userId);
await bob.page.locator('.app-shell[data-task-count="100"]').waitFor({ timeout: 30_000 });

const all = {
  authoritativeReadAdmin: [],
  mutationToOriginQuery: [],
  mutationToSecondClientPush: [],
  browserReconnectAndResubscribe: [],
  productionClientBuild: [],
};

try {
  const taskId = await alice.page.locator(".task-row").first().getAttribute("data-task-id");
  const originalTitle = await alice.page
    .locator(".task-row").first().locator('input:not([type="checkbox"])').inputValue();
  if (!taskId) throw new Error("performance task missing");

  for (let index = 0; index < totalSamples; index += 1) {
    all.authoritativeReadAdmin.push(await timed(() => admin("summary")));

    const marker = `Perf ${index} ${Date.now()}`;
    const input = alice.page.locator(
      `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
    );
    const started = performance.now();
    await input.fill(marker);
    await input.press("Tab");
    await alice.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
    all.mutationToOriginQuery.push(Number((performance.now() - started).toFixed(3)));
    await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 30_000 });
    all.mutationToSecondClientPush.push(Number((performance.now() - started).toFixed(3)));

    const restore = alice.page.locator(
      `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
    );
    await restore.fill(originalTitle);
    await restore.press("Tab");
    await bob.page.getByLabel(`Title ${originalTitle}`).waitFor({ timeout: 30_000 });

    await bob.context.close();
    all.browserReconnectAndResubscribe.push(await timed(async () => {
      bob = await open("chrome-performance-bob", 100);
    }));
    all.productionClientBuild.push(await timed(() =>
      command(path.resolve(workRoot, "node_modules/.bin/vite"), ["build"], armEnv)
    ));
  }

  const measurements = Object.fromEntries(
    Object.entries(all).map(([name, values]) => [name, stats(values.slice(warmups))]),
  );
  const warmupSamplesMs = Object.fromEntries(
    Object.entries(all).map(([name, values]) => [name, values.slice(0, warmups)]),
  );
  const receipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ok: Object.values(measurements).every(
      (measurement) => measurement.rawMs.length === recordedSamples,
    ),
    warmups,
    recordedSamples,
    measurements,
    warmupSamplesMs,
    machineContext: {
      target: "official InstantDB self-host images",
      client: "Chrome headless on the same machine",
      dataset: "four lists and 100 tasks",
    },
    scope: "fresh local small-profile measurements; not production latency",
    containsSecretValues: false,
  };
  await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
  await writeFile(
    path.resolve(armRoot, "receipts/performance.v1.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.ok) process.exitCode = 1;
} finally {
  await Promise.allSettled([alice.context.close(), bob.context.close()]);
}
