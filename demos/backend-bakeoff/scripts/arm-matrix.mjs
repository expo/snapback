#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newCapsule, verifyCapsule } from "./run-capsule.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const bakeoffRoot = path.resolve(here, "..");
const apps = ["todo", "chat", "linear", "partiful", "research-room"];

// @ref LLP 0102#program-stages — retain all 35 attempts and the prospective
// randomized order, but refuse to scaffold them until Stage 0 is truly ready.
export function matrixEntries(order) {
  return apps.flatMap((app) => order.orders[app].map((provider, orderIndex) => ({
    app,
    provider,
    round: app === "todo" || app === "chat" ? "calibration" : "deep",
    orderIndex: orderIndex + 1,
    attemptId: `${app}-${provider}-${app === "todo" || app === "chat" ? "calibration" : "deep"}-01`,
  })));
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function load(relative) {
  return JSON.parse(await readFile(path.join(bakeoffRoot, relative), "utf8"));
}

export async function armStatus() {
  const order = await load("protocol/order.v1.json");
  const entries = matrixEntries(order);
  const results = [];
  for (const entry of entries) {
    const relative = path.join("arms", entry.app, entry.provider, "run-capsule.v1.json");
    const absolute = path.join(bakeoffRoot, relative);
    if (!await exists(absolute)) {
      results.push({ ...entry, relative, state: "not-scaffolded" });
      continue;
    }
    const capsule = JSON.parse(await readFile(absolute, "utf8"));
    const problems = await verifyCapsule(capsule, { allowDraft: capsule.result === "pending" });
    results.push({
      ...entry,
      relative,
      state: problems.length === 0 ? capsule.result : "invalid",
      problems,
    });
  }
  return results;
}

async function scaffold() {
  const [health, freeze, order] = await Promise.all([
    load("protocol/credentials-health.v1.json"),
    load("protocol/freeze.v2.json"),
    load("protocol/order.v1.json"),
  ]);
  if (!health.readyForTimedArms || freeze.readinessAtFreeze !== "ready") {
    throw new Error("refusing to scaffold arms before credentials-health and frozen readiness are both ready");
  }
  for (const entry of matrixEntries(order)) {
    const output = path.join(bakeoffRoot, "arms", entry.app, entry.provider, "run-capsule.v1.json");
    if (await exists(output)) continue;
    const capsule = await newCapsule(entry);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(capsule, null, 2)}\n`, { flag: "wx" });
  }
  return armStatus();
}

async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "status") {
    const results = await armStatus();
    console.log(JSON.stringify({
      schemaVersion: 1,
      total: results.length,
      counts: Object.fromEntries([...new Set(results.map((item) => item.state))]
        .sort()
        .map((state) => [state, results.filter((item) => item.state === state).length])),
      arms: results,
    }, null, 2));
    return;
  }
  if (command === "scaffold") {
    const results = await scaffold();
    console.log(JSON.stringify({ ok: true, total: results.length }, null, 2));
    return;
  }
  throw new Error("usage: node scripts/arm-matrix.mjs <status|scaffold>");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
