#!/usr/bin/env node
import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_URL, FIXTURES, replayLog, createReplayState, parseActionLine, replayLine } from "./replay-engine.mjs";
import { readFile } from "node:fs/promises";

const url = process.env.SNAPBACK_URL ?? "http://127.0.0.1:49362";
const logPath = resolve(FIXTURES, "scale.log");
const out = resolve(process.cwd(), "receipts/scale-replay.json");
const progress = resolve(process.cwd(), "receipts/scale-progress.jsonl");

const start = Date.now();
const startEpoch = Math.floor(start / 1000);
await appendFile(progress, JSON.stringify({ t: startEpoch, event: "start", url }) + "\n");

const state = createReplayState();
for (const name of ["starter-m1.log", "starter-m2.log", "starter-m3.log"]) {
  const result = await replayLog(url, resolve(FIXTURES, name), state, { allowExisting: true });
  await appendFile(progress, JSON.stringify({ t: Date.now(), event: "starter", name, actions: result.actions }) + "\n");
}

const text = await readFile(logPath, "utf8");
const lines = text.split("\n").filter((line) => line.length > 0);
let n = 0;
const checkpoints = [];
for (const line of lines) {
  const parsed = parseActionLine(line);
  if (parsed.kind === "marker") {
    checkpoints.push({ marker: parsed.line, atAction: n, ms: Date.now() - start });
    await appendFile(progress, JSON.stringify({ t: Date.now(), event: "checkpoint", marker: parsed.line, actions: n }) + "\n");
    continue;
  }
  await replayLine(url, state, parsed, { allowExisting: true });
  n++;
  if (n % 500 === 0) {
    await appendFile(progress, JSON.stringify({ t: Date.now(), event: "progress", actions: n, ms: Date.now() - start }) + "\n");
    console.log(`scale ${n}/${lines.length} ${(Date.now() - start) / 1000}s`);
  }
}

const endEpoch = Math.floor(Date.now() / 1000);
const summary = {
  ok: true,
  url,
  startEpoch,
  endEpoch,
  wallSeconds: endEpoch - startEpoch,
  actions: n,
  checkpoints,
  users: state.users.size,
};
await writeFile(out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
