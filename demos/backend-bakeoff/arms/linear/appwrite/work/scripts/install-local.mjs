import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import {
  composeRoot,
  httpsPort,
  installerEndpoint,
  installerImage,
  installerName,
  namespace,
  runtimeFile,
  runtimeRoot,
  apiPort,
} from "./constants.mjs";

await mkdir(runtimeRoot, { recursive: true });
await mkdir(composeRoot, { recursive: true });
let credentials;
try {
  credentials = JSON.parse(await readFile(runtimeFile, "utf8"));
} catch {
  credentials = {
    email: "owner@llp0102-linear.appwrite.test",
    password: randomBytes(24).toString("base64url"),
    opensslKey: randomBytes(48).toString("base64url"),
  };
  await writeFile(runtimeFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await chmod(runtimeFile, 0o600);
}

const existing = spawnSync("docker", ["inspect", installerName], { encoding: "utf8" });
if (existing.status !== 0) {
  execFileSync("docker", [
    "run", "-d",
    "--name", installerName,
    "--label", `llp0102.arm=${namespace}`,
    "--env", `COMPOSE_PROJECT_NAME=${namespace}`,
    "--publish", "127.0.0.1:20081:20080",
    "--volume", "/var/run/docker.sock:/var/run/docker.sock",
    "--volume", `${composeRoot}:/usr/src/code/appwrite:rw`,
    "--entrypoint", "install",
    installerImage,
  ], { stdio: "inherit" });
}

let ready = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    const response = await fetch(installerEndpoint);
    if (response.ok) { ready = true; break; }
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
    emailCertificates: credentials.email,
    opensslKey: credentials.opensslKey,
    assistantOpenAIKey: "",
    accountEmail: credentials.email,
    accountPassword: credentials.password,
    migrate: false,
  }),
});
if (!response.ok || !response.body) {
  throw new Error(`Installer request returned ${response.status}`);
}
const reader = response.body.getReader();
const decoder = new TextDecoder();
let body = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  body += decoder.decode(value, { stream: true });
  if (body.includes("\"status\":\"error\"")) throw new Error("Installer reported an error");
}
console.log(JSON.stringify({
  ok: true,
  installerImage,
  composeProjectRequested: namespace,
  apiPort,
  httpsPort,
  secretValuesPrinted: false,
}));
