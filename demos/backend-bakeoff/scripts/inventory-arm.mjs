#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// @ref LLP 0102#measurement-record — keep authored, generated, test, policy,
// configuration, dependency-manifest, and installed-dependency cost distinct.
const armArgument = process.argv[2];
if (!armArgument) {
  console.error("usage: node scripts/inventory-arm.mjs <arm-directory>");
  process.exit(2);
}

const armRoot = path.resolve(process.cwd(), armArgument);
const ignored = new Set([".git", ".next", "coverage", "dist", "build"]);
const generatedSegments = new Set(["generated", "_generated", "module_bindings"]);
const policyPatterns = [/rules/i, /policy/i, /permissions?/i, /rls/i];
const configNames = new Set([
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "firebase.json",
  "firestore.indexes.json",
  "firestore.rules",
  "supabase/config.toml",
  "appwrite.config.json",
]);

const records = [];
let dependencyBytes = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(armRoot, absolute).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        dependencyBytes += await directoryBytes(absolute);
      } else {
        await walk(absolute);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const body = await readFile(absolute);
    const text = body.includes(0) ? null : body.toString("utf8");
    records.push({
      path: relative,
      category: classify(relative),
      bytes: body.byteLength,
      lines: text === null ? null : text.length === 0 ? 0 : text.split(/\r?\n/).length,
      sha256: createHash("sha256").update(body).digest("hex"),
    });
  }
}

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(absolute);
    else if (entry.isFile()) total += (await stat(absolute)).size;
  }
  return total;
}

function classify(relative) {
  const segments = relative.split("/");
  const basename = segments.at(-1);
  if (generatedSegments.size && segments.some((segment) => generatedSegments.has(segment))) return "generated";
  if (/(^|\/)(test|tests|acceptance|e2e)(\/|\.|$)/i.test(relative) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative)) return "test";
  if (policyPatterns.some((pattern) => pattern.test(relative))) return "policy";
  if (/lock|package-lock|bun\.lock|pnpm-lock|yarn\.lock/.test(relative)) return "dependency-manifest";
  if (configNames.has(relative) || configNames.has(basename) || /\.(json|toml|yaml|yml)$/.test(relative)) return "configuration";
  return "authored-source";
}

await walk(armRoot);
records.sort((left, right) => left.path.localeCompare(right.path));

const totals = {};
for (const record of records) {
  const category = totals[record.category] ?? { files: 0, bytes: 0, lines: 0 };
  category.files += 1;
  category.bytes += record.bytes;
  if (record.lines !== null) category.lines += record.lines;
  totals[record.category] = category;
}

console.log(JSON.stringify({
  schemaVersion: 1,
  armRoot,
  generatedAt: new Date().toISOString(),
  totals,
  installedDependencyBytes: dependencyBytes,
  files: records,
}, null, 2));
