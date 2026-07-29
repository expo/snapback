import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";

const installer = process.env.APPWRITE_INSTALLER_URL ?? "http://127.0.0.1:20080";
const runtimeDir = resolve(".arm-runtime");
const credentialsPath = resolve(runtimeDir, "owner.json");

await mkdir(runtimeDir, { recursive: true });

let credentials;
try {
  credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
} catch {
  credentials = {
    email: "owner@llp0102.appwrite.test",
    password: randomBytes(24).toString("base64url"),
    opensslKey: randomBytes(48).toString("base64url"),
  };
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

const page = await fetch(installer);
if (!page.ok) throw new Error(`Installer page returned ${page.status}`);
const cookie = page.headers.get("set-cookie")?.split(";", 1)[0];
const html = await page.text();
const csrf = html.match(
  /<meta name="appwrite-installer-csrf" content="([^"]+)"/,
)?.[1];
if (!csrf || !cookie) throw new Error("Installer CSRF session was not present");

const headers = {
  "Content-Type": "application/json",
  "X-Appwrite-Installer-CSRF": csrf,
  Cookie: cookie,
};
const validation = await fetch(`${installer}/install/validate`, {
  method: "POST",
  headers,
});
if (!validation.ok) {
  throw new Error(`Installer validation returned ${validation.status}`);
}

const installId = randomUUID();
const response = await fetch(`${installer}/install`, {
  method: "POST",
  headers: {
    ...headers,
    Accept: "text/event-stream",
  },
  body: JSON.stringify({
    installId,
    httpPort: "8090",
    httpsPort: "8443",
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
let buffer = "";
let failed = false;

function consume(raw) {
  const event = raw.match(/^event:\s*(.+)$/m)?.[1] ?? "message";
  const payloadText = raw.match(/^data:\s*(.+)$/m)?.[1];
  if (!payloadText) return;
  const payload = JSON.parse(payloadText);
  if (event === "progress") {
    const status = payload.status ?? "unknown";
    const step = payload.step ?? "unknown";
    process.stdout.write(`${step}: ${status}\n`);
    if (status === "error") failed = true;
  } else if (event === "error") {
    failed = true;
    process.stdout.write("installer: error\n");
  } else if (event === "done") {
    process.stdout.write("installer: done\n");
  }
}

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
  let splitAt = buffer.indexOf("\n\n");
  while (splitAt >= 0) {
    consume(buffer.slice(0, splitAt));
    buffer = buffer.slice(splitAt + 2);
    splitAt = buffer.indexOf("\n\n");
  }
}
if (buffer.trim()) consume(buffer);
if (failed) process.exitCode = 1;
