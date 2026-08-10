#!/usr/bin/env node
// Assemble the published documentation projection into website/public/:
//   public/v/<closure>/** — immutable, closure-bound canonical snapshot
//   public/latest/**       — mutable byte-for-byte alias of that snapshot
//   public/guide/**        — compatibility alias for the original public URL
//   public/docs/index.html — redirect to /latest/
//   public/llms.txt        — root copy for agents probing the convention
// @ref LLP 0195#proposal — D3 snapshots are closure-derived and immutable;
// latest is an alias of the same generator-owned projection, not a second
// documentation authority.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const websiteRoot = path.join(here, "..");
const repoRoot = path.join(websiteRoot, "..");
const dist = path.join(repoRoot, "docs-site-dist");
const closureRecordPath = path.join(repoRoot, "guide/published-closure.json");

function fail(message, code = "SNAPBACK_DOCS_ASSEMBLY_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  if (argv.length === 0) return { check: false };
  if (argv.length === 1 && argv[0] === "--check") return { check: true };
  fail("usage: node website/scripts/assemble-docs.mjs [--check]");
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function readTree(root) {
  const files = new Map();
  function visit(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.set(relativePath, fs.readFileSync(absolutePath));
      } else {
        fail(`${absolutePath} is not a regular file or directory`);
      }
    }
  }
  visit(root);
  return files;
}

function compareTrees(leftRoot, rightRoot) {
  const left = readTree(leftRoot);
  const right = readTree(rightRoot);
  const paths = new Set([...left.keys(), ...right.keys()]);
  const differences = [];
  for (const relativePath of [...paths].sort()) {
    if (!left.has(relativePath)) differences.push(`missing from source: ${relativePath}`);
    else if (!right.has(relativePath)) differences.push(`missing from target: ${relativePath}`);
    else if (!left.get(relativePath).equals(right.get(relativePath))) {
      differences.push(`different bytes: ${relativePath}`);
    }
  }
  return differences;
}

function replaceDirectory(source, target) {
  const stage = `${target}.staging-${process.pid}`;
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, stage, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(stage, target);
}

function installImmutableSnapshot(source, target) {
  if (fs.existsSync(target)) {
    const differences = compareTrees(source, target);
    if (differences.length > 0) {
      fail(
        `refusing to change immutable docs snapshot ${target}:\n${differences.slice(0, 20).join("\n")}`,
        "SNAPBACK_DOCS_SNAPSHOT_IMMUTABLE",
      );
    }
    return "reused";
  }
  replaceDirectory(source, target);
  return "installed";
}

function validateAssembly({ publicRoot, closureVersion, snapshotBase }) {
  const snapshotDir = path.join(publicRoot, "v", closureVersion);
  const manifest = readJson(path.join(snapshotDir, "site-manifest.json"), "snapshot site manifest");
  const expectedRoutes = {
    policy: "immutable-closure-snapshot-with-latest-alias",
    snapshot: snapshotBase,
    latestAlias: "/latest/",
    renderedBase: snapshotBase,
    canonicalBase: snapshotBase,
    immutableSnapshot: true,
  };
  if (JSON.stringify(manifest.publicationRoutes) !== JSON.stringify(expectedRoutes)) {
    fail(`snapshot publicationRoutes mismatch: ${JSON.stringify(manifest.publicationRoutes)}`);
  }
  if (manifest.sourceBinding?.closure?.version !== closureVersion) {
    fail("snapshot manifest closure does not match its /v/<closure>/ path");
  }
  if (manifest.sourceBinding?.closure?.snapshotPath !== snapshotBase) {
    fail("snapshot manifest source binding does not name its immutable path");
  }
  for (const alias of ["latest", "guide"]) {
    const differences = compareTrees(snapshotDir, path.join(publicRoot, alias));
    if (differences.length > 0) {
      fail(`${alias} is not an exact snapshot alias:\n${differences.slice(0, 20).join("\n")}`);
    }
  }
  const rootLlms = fs.readFileSync(path.join(publicRoot, "llms.txt"));
  const snapshotLlms = fs.readFileSync(path.join(snapshotDir, "llms.txt"));
  if (!rootLlms.equals(snapshotLlms)) fail("root llms.txt is not the snapshot projection");
  const docsRedirect = fs.readFileSync(path.join(publicRoot, "docs/index.html"), "utf8");
  if (!docsRedirect.includes("url=/latest/") || !docsRedirect.includes('href="/latest/"')) {
    fail("/docs/ does not redirect to the /latest/ alias");
  }
  const snapshotIndex = fs.readFileSync(path.join(snapshotDir, "index.html"), "utf8");
  if (!snapshotIndex.includes(`<link rel="canonical" href="${snapshotBase}">`)) {
    fail("snapshot index does not carry its immutable canonical URL");
  }
}

function assemble(publicRoot) {
  const closure = readJson(closureRecordPath, "guide/published-closure.json");
  const closureVersion = closure.newestPublished;
  if (closure.schemaVersion !== "snapback-published-closure.v1"
      || !/^\d+\.\d+\.\d+$/u.test(closureVersion ?? "")) {
    fail("guide/published-closure.json does not name a valid published closure");
  }
  const snapshotBase = `/v/${closureVersion}/`;

  execFileSync(process.execPath, [
    path.join(repoRoot, "scripts/generate-docs-site.mjs"),
    "--base",
    snapshotBase,
  ], {
    cwd: repoRoot,
    stdio: "inherit",
  });

  fs.mkdirSync(publicRoot, { recursive: true });
  const snapshotDir = path.join(publicRoot, "v", closureVersion);
  const snapshotAction = installImmutableSnapshot(dist, snapshotDir);
  replaceDirectory(snapshotDir, path.join(publicRoot, "latest"));
  replaceDirectory(snapshotDir, path.join(publicRoot, "guide"));
  fs.copyFileSync(path.join(snapshotDir, "llms.txt"), path.join(publicRoot, "llms.txt"));

  fs.mkdirSync(path.join(publicRoot, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(publicRoot, "docs", "index.html"),
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/latest/"><link rel="canonical" href="/latest/"><title>Snapback docs</title><p>Moved to <a href="/latest/">/latest/</a>.</p>\n`,
  );

  validateAssembly({ publicRoot, closureVersion, snapshotBase });
  return { closureVersion, snapshotAction };
}

const options = parseArgs(process.argv.slice(2));
let publicRoot = path.join(websiteRoot, "public");
let temporaryRoot;
try {
  if (options.check) {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "snapback-docs-assembly-"));
    publicRoot = path.join(temporaryRoot, "public");
  }
  const result = assemble(publicRoot);
  if (options.check) {
    const probe = path.join(temporaryRoot, "immutability-probe");
    fs.cpSync(path.join(publicRoot, "v", result.closureVersion), probe, { recursive: true });
    fs.appendFileSync(path.join(probe, "index.html"), "<!-- mutation probe -->\n");
    try {
      installImmutableSnapshot(dist, probe);
      fail("immutable snapshot mutation probe unexpectedly succeeded");
    } catch (error) {
      if (error.code !== "SNAPBACK_DOCS_SNAPSHOT_IMMUTABLE") throw error;
    }
    console.log(
      `[assemble-docs] check ok: /v/${result.closureVersion}/ is immutable; ` +
      "/latest/ and /guide/ are exact aliases",
    );
  } else {
    console.log(
      `[assemble-docs] public/ ready: ${result.snapshotAction} /v/${result.closureVersion}/; ` +
      "refreshed /latest/, /guide/, /docs/, and /llms.txt",
    );
  }
} finally {
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
