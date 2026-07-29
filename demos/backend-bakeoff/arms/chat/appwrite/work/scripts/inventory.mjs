#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const armRoot = path.resolve(workRoot, "..");
const ignored = new Set([
  ".agents",
  ".arm-runtime",
  ".appwrite",
  ".env.local",
  "dist",
  "node_modules",
]);
const records = [];
let installedDependencyBytes = 0;

async function bytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    total += entry.isDirectory() ? await bytes(absolute) : (await stat(absolute)).size;
  }
  return total;
}

function category(relative) {
  if (relative.startsWith("scripts/")) return "test";
  if (relative === "appwrite.config.json") return "policy";
  if (/package-lock/.test(relative)) return "dependency-manifest";
  if (/package\.json|tsconfig|vite\.config|\.gitignore|oxlint/.test(relative)) {
    return "configuration";
  }
  return "authored-source";
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.name === "node_modules") {
      installedDependencyBytes += await bytes(absolute);
      continue;
    }
    if (ignored.has(entry.name) || entry.name.endsWith(".log")) continue;
    const relative = path.relative(workRoot, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    const body = await readFile(absolute);
    const text = body.includes(0) ? null : body.toString("utf8");
    records.push({
      path: relative,
      category: category(relative),
      bytes: body.length,
      lines: text === null ? null : text === "" ? 0 : text.split(/\r?\n/).length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
}

await walk(workRoot);
records.sort((left, right) => left.path.localeCompare(right.path));
const totals = {};
for (const record of records) {
  totals[record.category] ??= { files: 0, bytes: 0, lines: 0 };
  totals[record.category].files += 1;
  totals[record.category].bytes += record.bytes;
  if (record.lines !== null) totals[record.category].lines += record.lines;
}
const receipt = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  armRoot: "arms/chat/appwrite/work",
  totals,
  installedDependencyBytes,
  files: records,
  ignoredRuntime: [".arm-runtime", ".appwrite", ".env.local", "dist", "../runtime"],
  containsSecretValues: false,
};
await mkdir(path.resolve(armRoot, "receipts"), { recursive: true });
await writeFile(
  path.resolve(armRoot, "receipts/inventory.v1.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  files: records.length,
  installedDependencyBytes,
  totals,
})}\n`);
