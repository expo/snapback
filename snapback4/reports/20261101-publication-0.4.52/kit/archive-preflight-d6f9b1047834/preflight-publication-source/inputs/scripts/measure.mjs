#!/usr/bin/env node
// The loop, measured on every run (rules/RULES.md, adopted by LLP 3000 §4):
// the blocking suite's wall time, an incremental rebuild after touching one
// line, the chat app's built bytes, the production binary's bytes. Appends
// one line to metrics/loop.jsonl. `--check` exits 1 when a budget is missed.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
const timed = (fn) => { const t = process.hrtime.bigint(); fn(); return +(Number(process.hrtime.bigint() - t) / 1e9).toFixed(2); };
const sha = sh("git", ["rev-parse", "--short", "HEAD"]).trim();
const budgets = { test_s: 60, incremental_build_s: 15 };
const out = { at: new Date().toISOString(), sha };

out.test_s = timed(() => sh("bash", ["scripts/test.sh"]));
const main = join(root, "crates/snapback4/src/main.rs");
const now = new Date(); utimesSync(main, now, now);
out.incremental_build_s = timed(() => sh("cargo", ["build", "--quiet"]));
sh("bun", ["run", "--cwd", join(root, "apps/chat"), "build"]);
const assets = join(root, "apps/chat/dist/assets");
const js = readdirSync(assets).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(assets, f)));
out.chat_app_js_bytes = js.reduce((a, b) => a + b.length, 0);
out.chat_app_js_gzip_bytes = js.reduce((a, b) => a + gzipSync(b, { level: 9 }).length, 0);
sh("cargo", ["build", "--quiet", "--profile", "production"]);
out.production_binary_bytes = statSync(join(root, "target/production/snapback4")).size;
const misses = Object.entries(budgets).filter(([k, v]) => out[k] > v).map(([k, v]) => `${k}=${out[k]} > ${v}`);
out.ok = misses.length === 0;
mkdirSync(join(root, "metrics"), { recursive: true });
appendFileSync(join(root, "metrics/loop.jsonl"), JSON.stringify(out) + "\n");
console.log(JSON.stringify(out));
if (check && misses.length) { console.error("budget missed: " + misses.join(", ")); process.exit(1); }
