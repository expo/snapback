#!/usr/bin/env node
// Assemble the published documentation projection into website/public/:
//   public/guide/**      — the generated docs-site artifact, links rebased
//                          from "/" to "/guide/"
//   public/docs/index.html — redirect to /guide/ (docs and guide share one
//                          projection today; split when warranted)
//   public/llms.txt      — root copy for agents probing the convention,
//                          paths rewritten into /guide/
// The generator itself stays authoritative for content and link checking
// (scripts/generate-docs-site.mjs at the repo root); this script only
// mounts its output under a base path. Follow-on: first-class --base
// support in the generator (see issues/).
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

execFileSync("node", [path.join(repoRoot, "scripts/generate-docs-site.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
});

fs.rmSync(guideDir, { recursive: true, force: true });
fs.cpSync(dist, guideDir, { recursive: true });

// Rebase root-relative links in every emitted text file.
const exts = new Set([".html", ".txt", ".json", ".css", ".svg", ".xml"]);
const rebase = (s) =>
  s
    .replace(/(href|src)="\//g, '$1="/guide/')
    .replace(/(href|src)='\//g, "$1='/guide/")
    .replace(/url\(\//g, "url(/guide/");
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name))) {
      const before = fs.readFileSync(p, "utf8");
      const after = rebase(before);
      if (after !== before) fs.writeFileSync(p, after);
    }
  }
};
walk(guideDir);

// Root llms.txt: rewrite absolute and root-relative paths into /guide/.
const llms = fs
  .readFileSync(path.join(guideDir, "llms.txt"), "utf8")
  .replace(/\]\(\/(?!guide\/)/g, "](/guide/")
  .replace(/^(\s*)\/(?!guide\/)/gm, "$1/guide/");
fs.writeFileSync(path.join(pub, "llms.txt"), llms);

fs.mkdirSync(path.join(pub, "docs"), { recursive: true });
fs.writeFileSync(
  path.join(pub, "docs", "index.html"),
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/guide/"><link rel="canonical" href="/guide/"><title>Snapback docs</title><p>Moved to <a href="/guide/">/guide/</a>.</p>\n`
);

console.log("[assemble-docs] public/ ready:", fs.readdirSync(pub).join(", "));
