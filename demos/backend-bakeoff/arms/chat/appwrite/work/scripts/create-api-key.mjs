#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const runtimePath = resolve(".arm-runtime/owner.json");
const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
const cliPath = resolve("node_modules/appwrite-cli/dist/cli.cjs");
const result = spawnSync(process.execPath, [
  cliPath,
  "--json",
  "--show-secrets",
  "project",
  "create-key",
  "--key-id", "acceptance-key",
  "--name", "Acceptance harness",
  "--scopes",
  "users.read",
  "users.write",
  "teams.read",
  "teams.write",
  "databases.read",
  "databases.write",
  "tables.read",
  "tables.write",
  "collections.read",
  "collections.write",
  "columns.read",
  "columns.write",
  "attributes.read",
  "attributes.write",
  "indexes.read",
  "indexes.write",
  "rows.read",
  "rows.write",
  "documents.read",
  "documents.write",
  "presences.read",
  "presences.write",
], { cwd: process.cwd(), encoding: "utf8" });
if (result.status !== 0) {
  throw new Error(result.stderr || "Appwrite API-key creation failed");
}
const key = JSON.parse(result.stdout);
if (!key.secret) throw new Error("Appwrite did not return the new API-key secret");
runtime.apiKey = key.secret;
runtime.apiKeyId = key.$id;
await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
await chmod(runtimePath, 0o600);
process.stdout.write(`${JSON.stringify({
  ok: true,
  keyId: key.$id,
  scopes: key.scopes,
  secretValuesPrinted: false,
})}\n`);
