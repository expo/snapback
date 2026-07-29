#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
const all = warmups + recordedSamples;

function command(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command} exited ${code}`));
    });
  });
}

async function timed(operation) {
  const start = performance.now();
  await operation();
  return Number((performance.now() - start).toFixed(3));
}

async function open(persona) {
  const context = await chromium.launchPersistentContext(
    path.resolve(runtimeRoot, `chrome-${persona}`),
    { executablePath: chromePath, headless: true },
  );
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:4179/?persona=${persona}`);
  await page
    .locator('.app-shell[data-ready="true"][data-task-count="100"]')
    .waitFor({ timeout: 20_000 });
  await page.locator("li").first().waitFor({ timeout: 20_000 });
  return { context, page };
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    rawMs: values,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    nearestRankP95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
  };
}

const alice = await open("alice");
let bob = await open("bob");
const samples = {
  authoritativeReadCli: [],
  mutationToOriginQuery: [],
  mutationToSecondClientPush: [],
  browserReconnectAndResubscribe: [],
  productionClientBuild: [],
};

try {
  const taskId = await alice.page.locator("li").first().getAttribute("data-task-id");
  const originalTitle = await alice.page
    .locator("li")
    .first()
    .locator('input:not([type="checkbox"])')
    .inputValue();
  if (!taskId) throw new Error("performance task missing");

  for (let index = 0; index < all; index += 1) {
    samples.authoritativeReadCli.push(
      await timed(() => command(process.execPath, [
        path.resolve(workRoot, "scripts/admin-cli.mjs"),
        "summary",
      ])),
    );

    const marker = `Perf ${index} ${Date.now()}`;
    const input = alice.page.locator(
      `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
    );
    const start = performance.now();
    await input.fill(marker);
    await input.press("Tab");
    await alice.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 20_000 });
    samples.mutationToOriginQuery.push(Number((performance.now() - start).toFixed(3)));
    await bob.page.getByLabel(`Title ${marker}`).waitFor({ timeout: 20_000 });
    samples.mutationToSecondClientPush.push(
      Number((performance.now() - start).toFixed(3)),
    );
    const restore = alice.page.locator(
      `li[data-task-id="${taskId}"] input:not([type="checkbox"])`,
    );
    await restore.fill(originalTitle);
    await restore.press("Tab");
    await bob.page.getByLabel(`Title ${originalTitle}`).waitFor({ timeout: 20_000 });

    await bob.context.close();
    samples.browserReconnectAndResubscribe.push(
      await timed(async () => {
        bob = await open("bob");
      }),
    );
    samples.productionClientBuild.push(
      await timed(() => command(
        path.resolve(workRoot, "node_modules/.bin/vite"),
        ["build"],
      )),
    );
  }

  const measurements = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [
      name,
      stats(values.slice(warmups)),
    ]),
  );
  const warmupSamplesMs = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => [name, values.slice(0, warmups)]),
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
    scope:
      "official anonymous local deployment, one machine, frozen small Todo dataset; not production scale",
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
