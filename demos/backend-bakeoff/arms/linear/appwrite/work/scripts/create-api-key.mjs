import { spawnSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cliHome, runtimeFile } from "./constants.mjs";

const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
const result = spawnSync(process.execPath, [
  path.resolve("node_modules/appwrite-cli/dist/cli.cjs"),
  "--json",
  "--show-secrets",
  "project",
  "create-key",
  "--key-id", "linear-acceptance-key",
  "--name", "Linear acceptance harness",
  "--scopes",
  "users.read", "users.write",
  "teams.read", "teams.write",
  "databases.read", "databases.write",
  "tables.read", "tables.write",
  "columns.read", "columns.write",
  "indexes.read", "indexes.write",
  "rows.read", "rows.write",
], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, HOME: cliHome },
});
if (result.status !== 0) throw new Error(result.stderr || "API-key creation failed");
const key = JSON.parse(result.stdout);
if (!key.secret) throw new Error("Appwrite did not return an API-key secret");
runtime.apiKey = key.secret;
runtime.apiKeyId = key.$id;
await writeFile(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`, { mode: 0o600 });
await chmod(runtimeFile, 0o600);
console.log(JSON.stringify({ ok: true, keyId: key.$id, scopes: key.scopes, secretValuesPrinted: false }));
