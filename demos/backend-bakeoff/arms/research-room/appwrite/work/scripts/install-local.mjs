import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import {
  apiPort,
  composeRoot,
  httpsPort,
  installerEndpoint,
  installerImage,
  installerName,
  namespace,
  runtimeFile,
  runtimeRoot,
} from "./constants.mjs";

await mkdir(runtimeRoot, { recursive: true });
await mkdir(composeRoot, { recursive: true });
let owner;
try {
  owner = JSON.parse(await readFile(runtimeFile, "utf8"));
} catch {
  owner = {
    email: "owner@llp0102-research.appwrite.test",
    password: randomBytes(24).toString("base64url"),
    opensslKey: randomBytes(48).toString("base64url"),
  };
  await writeFile(runtimeFile, `${JSON.stringify(owner, null, 2)}\n`, { mode: 0o600 });
  await chmod(runtimeFile, 0o600);
}

const existing = spawnSync("docker", ["inspect", installerName], { encoding: "utf8" });
if (existing.status !== 0) {
  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    installerName,
    "--label",
    `llp0102.arm=${namespace}`,
    "--env",
    `COMPOSE_PROJECT_NAME=${namespace}`,
    "--publish",
    `127.0.0.1:${installerEndpoint.split(":").at(-1)}:20080`,
    "--volume",
    "/var/run/docker.sock:/var/run/docker.sock",
    "--volume",
    `${composeRoot}:/usr/src/code/appwrite:rw`,
    "--entrypoint",
    "install",
    installerImage,
  ], { stdio: "inherit" });
}

async function copyComposeFiles() {
  for (const file of ["docker-compose.yml", ".env", "mongo-entrypoint.sh", "mongo-init.js"]) {
    execFileSync("docker", [
      "cp",
      `${installerName}:/usr/src/code/appwrite/${file}`,
      `${composeRoot}/${file}`,
    ]);
  }
}

const existingHealth = await fetch(`http://127.0.0.1:${apiPort}/v1/health/version`).catch(() => null);
if (existingHealth?.ok) {
  await copyComposeFiles();
  console.log(JSON.stringify({
    ok: true,
    installerImage,
    composeProjectRequested: namespace,
    apiPort,
    httpsPort,
    installerStreamRecovered: true,
    composeFilesCopiedFromArmLabeledInstaller: true,
    secretValuesPrinted: false,
  }));
  process.exit(0);
}

let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    const response = await fetch(installerEndpoint);
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) throw new Error("Official Appwrite web installer did not become ready");

const page = await fetch(installerEndpoint);
const cookie = page.headers.get("set-cookie")?.split(";", 1)[0];
const html = await page.text();
const csrf = html.match(/<meta name="appwrite-installer-csrf" content="([^"]+)"/)?.[1];
if (!csrf || !cookie) throw new Error("Installer CSRF session was not present");
const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Installer-CSRF": csrf,
  Cookie: cookie,
};
const validation = await fetch(`${installerEndpoint}/install/validate`, {
  method: "POST",
  headers,
});
if (!validation.ok) throw new Error(`Installer validation returned ${validation.status}`);
const response = await fetch(`${installerEndpoint}/install`, {
  method: "POST",
  headers: { ...headers, Accept: "text/event-stream" },
  body: JSON.stringify({
    installId: randomUUID(),
    httpPort: String(apiPort),
    httpsPort: String(httpsPort),
    database: "mongodb",
    appDomain: "localhost",
    emailCertificates: owner.email,
    opensslKey: owner.opensslKey,
    assistantOpenAIKey: "",
    accountEmail: owner.email,
    accountPassword: owner.password,
    migrate: false,
  }),
});
if (!response.ok || !response.body) {
  throw new Error(`Installer request returned ${response.status}`);
}
const reader = response.body.getReader();
const decoder = new TextDecoder();
let body = "";
let installerStreamRecovered = false;
try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
    if (body.includes("\"status\":\"error\"")) throw new Error("Installer reported an error");
  }
} catch (error) {
  const health = await fetch(`http://127.0.0.1:${apiPort}/v1/health/version`).catch(() => null);
  if (!health?.ok) throw error;
  installerStreamRecovered = true;
}
await copyComposeFiles();
console.log(JSON.stringify({
  ok: true,
  installerImage,
  composeProjectRequested: namespace,
  apiPort,
  httpsPort,
  installerStreamRecovered,
  composeFilesCopiedFromArmLabeledInstaller: true,
  secretValuesPrinted: false,
}));
