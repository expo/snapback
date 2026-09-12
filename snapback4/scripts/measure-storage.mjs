#!/usr/bin/env node
// What the store weighs at scale (after the Snapback 2 Clique 0.0.29 run:
// 5.2 GB, 70% indexes, recipient delivery records). The chat backend
// seeded with many groups of many messages and members; `snapback4 doctor
// --json` weighs the rows, the index entries and the partition log. One
// line to metrics/storage.jsonl.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binary as binaryPath, root, scaleSeed } from "../witness/lib.mjs";

const groups = Number(process.argv[2] ?? 40);
const messages = Number(process.argv[3] ?? 500);
const members = Number(process.argv[4] ?? 10);
const binary = binaryPath();
const app = mkdtempSync(join(tmpdir(), "sb4-storage-"));
cpSync(join(root, "apps/chat/snapback"), join(app, "snapback"), { recursive: true });
rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
const port = 4490 + (process.pid % 20);
const api = `http://127.0.0.1:${port}`;
const server = spawn(binary, ["dev", "--port", String(port), "--no-watch"], { cwd: app, stdio: ["ignore", "ignore", "inherit"] });
let out;
try {
  for (let i = 0; i < 100; i++) { try { await fetch(api); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
  const t0 = performance.now();
  const seeded = await fetch(`${api}/seed`, { method: "POST", body: JSON.stringify(scaleSeed({ groups, messages, members })) }).then((r) => r.json());
  const seedMs = +(performance.now() - t0).toFixed(0);
  server.kill();
  await new Promise((r) => server.on("exit", r));
  const doctor = spawnSync(binary, ["doctor", "--json"], { cwd: app, encoding: "utf8" });
  const report = JSON.parse(doctor.stdout.trim().split("\n").pop());
  const s = report.storage;
  out = { at: new Date().toISOString(), binary: process.env.SNAPBACK4_BIN ? "release" : "debug", groups, messages, members, seeded: seeded.seeded, seedMs, rowsBytes: s.rows, rowCount: s.row_count, indexBytes: s.indexes, logBytes: s.log, logEvents: s.log_events, fileBytes: s.file, logPerRows: +(s.log / s.rows).toFixed(2), filePerRows: +(s.file / s.rows).toFixed(2) };
} finally {
  server.kill();
  rmSync(app, { recursive: true, force: true });
}
console.log(JSON.stringify(out));
const path = join(root, "metrics/storage.jsonl");
let existing = "";
try { existing = readFileSync(path, "utf8"); } catch { /* first line */ }
writeFileSync(path, `${existing}${JSON.stringify(out)}\n`);
