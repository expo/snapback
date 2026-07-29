#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const endpoint = "http://127.0.0.1:8090/v1";
const organizationId = "llp0102-owner-org";
const runtime = JSON.parse(await readFile(resolve(".arm-runtime/owner.json"), "utf8"));

const sessionResponse = await fetch(`${endpoint}/account/sessions/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-appwrite-project": "console",
    "x-fallback-cookies": "true",
  },
  body: JSON.stringify({ email: runtime.email, password: runtime.password }),
});
if (!sessionResponse.ok) throw new Error(`Console login returned ${sessionResponse.status}`);
const cookie = sessionResponse.headers.getSetCookie()
  .map((value) => value.split(";", 1)[0]).join("; ");
const teamResponse = await fetch(`${endpoint}/teams`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-appwrite-project": "console",
    cookie,
  },
  body: JSON.stringify({ teamId: organizationId, name: "LLP 0102 owner" }),
});
if (!teamResponse.ok && teamResponse.status !== 409) {
  throw new Error(`Organization bootstrap returned ${teamResponse.status}`);
}

function cli(args) {
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/appwrite-cli/dist/cli.cjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `appwrite ${args[0]} failed`);
  }
}

cli([
  "login",
  "--endpoint", endpoint,
  "--email", runtime.email,
  "--password", runtime.password,
]);
cli([
  "init", "project",
  "--organization-id", organizationId,
  "--project-id", "llp0102-chat-appwrite",
  "--project-name", "LLP 0102 Chat Appwrite",
]);

process.stdout.write(`${JSON.stringify({
  ok: true,
  organizationId,
  projectId: "llp0102-chat-appwrite",
  secretValuesPrinted: false,
})}\n`);
