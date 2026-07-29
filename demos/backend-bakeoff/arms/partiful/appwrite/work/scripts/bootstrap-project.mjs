import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cliHome, endpoint, projectId, runtimeFile } from "./constants.mjs";

const organizationId = "llp0102-partiful-owner-org";
const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
await mkdir(cliHome, { recursive: true });

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
  body: JSON.stringify({ teamId: organizationId, name: "LLP 0102 Partiful owner" }),
});
if (!teamResponse.ok && teamResponse.status !== 409) {
  throw new Error(`Organization bootstrap returned ${teamResponse.status}`);
}

function cli(args) {
  const result = spawnSync(
    process.execPath,
    [path.resolve("node_modules/appwrite-cli/dist/cli.cjs"), ...args],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, HOME: cliHome },
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
cli(["login", "--endpoint", endpoint, "--email", runtime.email, "--password", runtime.password]);
cli([
  "init", "project",
  "--organization-id", organizationId,
  "--project-id", projectId,
  "--project-name", "LLP 0102 Partiful Appwrite W3",
]);
cli([
  "project", "create-web-platform",
  "--platform-id", "partiful-local-web",
  "--name", "Partiful local web",
  "--hostname", "127.0.0.1",
]);
console.log(JSON.stringify({ ok: true, organizationId, projectId, cliHome, secretValuesPrinted: false }));
