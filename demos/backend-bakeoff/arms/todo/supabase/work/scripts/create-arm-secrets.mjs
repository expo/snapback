#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretsSource = "/Users/ccheever/Dropbox/APIKeys/dogfood-matrix-secrets.md";
const markdown = await readFile(secretsSource, "utf8");
const lines = markdown.split(/\r?\n/);

function clean(value) {
  return value.trim()
    .replace(/^[-*]\s+/, "")
    .replace(/^`(.*)`$/, "$1")
    .replace(/^['"](.*)['"]$/, "$1")
    .trim();
}

function credential(label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matchLabel = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:\`${escaped}\`|${escaped})\\s*[:=]\\s*(.*?)\\s*$`,
    "i",
  );
  const anyAssignment = /^\s*(?:[-*]\s+)?(?:`[^`]+`|[A-Za-z][A-Za-z0-9 _-]*)\s*[:=]/;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(matchLabel);
    if (!match) continue;
    const sameLine = clean(match[1]);
    if (sameLine.length >= 8 && !/^(?:<.*>|redacted|todo|tbd|none|null|\.\.\.)$/i.test(sameLine)) {
      return sameLine;
    }
    const rawNext = lines[index + 1] ?? "";
    if (/^\s*#/.test(rawNext) || anyAssignment.test(rawNext)) continue;
    const nextLine = clean(rawNext);
    if (nextLine.length >= 8 && !/^(?:<.*>|redacted|todo|tbd|none|null|\.\.\.)$/i.test(nextLine)) {
      return nextLine;
    }
  }
  return "";
}

const values = {
  VITE_SUPABASE_URL: credential("SUPABASE_URL"),
  VITE_SUPABASE_PUBLISHABLE_KEY:
    credential("SUPABASE_PUBLISHABLE_KEY") || credential("SUPABASE_ANON_KEY"),
  SUPABASE_SECRET_KEY: credential("SUPABASE_SECRET_KEY"),
  DIRECT_URL: credential("DIRECT_URL"),
  DATABASE_URL: credential("DATABASE_URL"),
  ALICE_EMAIL: "llp0102-todo-supabase-alice@example.test",
  BOB_EMAIL: "llp0102-todo-supabase-bob@example.test",
  MALLORY_EMAIL: "llp0102-todo-supabase-mallory@example.test",
  ALICE_PASSWORD: randomBytes(24).toString("base64url"),
  BOB_PASSWORD: randomBytes(24).toString("base64url"),
  MALLORY_PASSWORD: randomBytes(24).toString("base64url"),
};
const missing = Object.entries(values)
  .filter(([, value]) => !value)
  .map(([name]) => name);
if (missing.length > 0) throw new Error(`missing required secret labels: ${missing.join(", ")}`);
await mkdir(workRoot, { recursive: true });
await writeFile(
  path.resolve(workRoot, ".arm-secrets"),
  `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
  { encoding: "utf8", mode: 0o600 },
);
await writeFile(
  path.resolve(workRoot, ".env.local"),
  [
    `VITE_SUPABASE_URL=${values.VITE_SUPABASE_URL}`,
    `VITE_SUPABASE_PUBLISHABLE_KEY=${values.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);
process.stdout.write(`${JSON.stringify({
  ok: true,
  valuesWritten: Object.keys(values).length,
  outputMode: "0600 for both ignored files",
  secretValuesPrinted: false,
})}\n`);
