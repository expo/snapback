#!/usr/bin/env node
// Assemble the published documentation projection into website/public/:
//   public/guide/**      — the generated docs-site artifact, emitted for
//                          the "/guide/" base path
//   public/docs/index.html — redirect to /guide/ (docs and guide share one
//                          projection today; split when warranted)
//   public/llms.txt      — root copy for agents probing the convention
// The generator itself stays authoritative for content and link checking
// (scripts/generate-docs-site.mjs at the repo root), including the mounted
// URL base. This script only places its already-valid output.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const websiteRoot = path.join(here, "..");
const repoRoot = path.join(websiteRoot, "..");
const dist = path.join(repoRoot, "docs-site-dist");
const pub = path.join(websiteRoot, "public");
const guideDir = path.join(pub, "guide");

execFileSync(process.execPath, [
  path.join(repoRoot, "scripts/generate-docs-site.mjs"),
  "--base",
  "/guide/",
], {
  cwd: repoRoot,
  stdio: "inherit",
});

fs.rmSync(guideDir, { recursive: true, force: true });
fs.cpSync(dist, guideDir, { recursive: true });

fs.copyFileSync(path.join(guideDir, "llms.txt"), path.join(pub, "llms.txt"));

fs.mkdirSync(path.join(pub, "docs"), { recursive: true });
fs.writeFileSync(
  path.join(pub, "docs", "index.html"),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/guide/"><link rel="canonical" href="/guide/"><title>Snapback docs</title><p>Moved to <a href="/guide/">/guide/</a>.</p>\n`
);

console.log("[assemble-docs] public/ ready:", fs.readdirSync(pub).join(", "));
