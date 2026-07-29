import { chmod, writeFile } from "node:fs/promises";

const apiURI = process.env.INSTANT_CLI_API_URI;
if (!apiURI) {
  throw new Error("INSTANT_CLI_API_URI is required");
}

const response = await fetch(`${apiURI}/dash/apps/ephemeral`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "llp0102-todo-instantdb" }),
});

if (!response.ok) {
  throw new Error(`InstantDB app creation failed (${response.status})`);
}

const payload = await response.json();
const appId = payload?.app?.id;
const adminToken = payload?.app?.["admin-token"];
if (!appId || !adminToken) {
  throw new Error("InstantDB app response was missing credentials");
}

const websocketURI = apiURI.replace(/^http/, "ws") + "/runtime/session";
const env = [
  `VITE_INSTANT_APP_ID=${appId}`,
  `INSTANT_APP_ADMIN_TOKEN=${adminToken}`,
  `VITE_INSTANT_API_URI=${apiURI}`,
  `VITE_INSTANT_WEBSOCKET_URI=${websocketURI}`,
  "",
].join("\n");

await writeFile(".arm-secrets", env, { mode: 0o600 });
await chmod(".arm-secrets", 0o600);
console.log(JSON.stringify({ ok: true, appCreated: true, secretValuesPrinted: false }));
