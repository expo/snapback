import { ConvexHttpClient } from "convex/browser";
import { ConvexReactClient } from "convex/react";
import { importJWK, SignJWT } from "jose";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api.js";

const root = resolve(import.meta.dirname, "..");
const receipt = resolve(root, "..", "receipts/logout-diagnosis-readonly.json");
const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const privateJwk = JSON.parse(
  await readFile(resolve(root, ".arm-runtime/private-jwk.json"), "utf8"),
);
const privateKey = await importJWK(privateJwk, "RS256");
const token = await new SignJWT({ name: "Bob" })
  .setProtectedHeader({ alg: "RS256", kid: "llp0102-dev" })
  .setIssuer("https://llp0102-chat-convex.local")
  .setAudience("llp0102-chat-convex")
  .setSubject("bob")
  .setIssuedAt()
  .setExpirationTime("2h")
  .sign(privateKey);

const events = [];
const client = new ConvexReactClient(url, { logger: false });
await new Promise((resolveAuth, reject) => {
  const timeout = setTimeout(() => reject(new Error("auth timeout")), 5000);
  client.setAuth(async () => token, (authenticated) => {
    events.push({ event: "onAuthChange", authenticated, at: Date.now() });
    if (authenticated) {
      clearTimeout(timeout);
      resolveAuth();
    }
  });
});

const channel = await client.query(api.chat.channelBySlug, { slug: "project-alpha" });
const before = await client.query(api.chat.latestMessages, {
  channelId: channel._id,
  limit: 200,
});
const authoritativeLogoutRows = before
  .filter((row) => row.body.startsWith("after-logout-"))
  .map((row) => ({
    id: row._id,
    body: row.body,
    sequence: row.sequence,
    authorSubject: row.authorSubject,
    sentAt: row.sentAt,
    creationTime: row._creationTime,
  }));

const watch = client.watchQuery(api.chat.latestMessages, {
  channelId: channel._id,
  limit: 25,
});
let watchInitial = null;
let watchError = null;
const unsubscribe = watch.onUpdate(() => {
  try {
    const value = watch.localQueryResult();
    watchInitial ??= value.map((row) => row._id);
    events.push({
      event: "watch-update",
      rowCount: value.length,
      containsLogoutRow: value.some((row) => row.body.startsWith("after-logout-")),
      at: Date.now(),
    });
  } catch (error) {
    watchError = String(error);
    events.push({ event: "watch-error", error: watchError, at: Date.now() });
  }
});
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
events.push({ event: "clearAuth-called", at: Date.now() });
client.clearAuth();
await new Promise((resolveWait) => setTimeout(resolveWait, 1000));

let sameClientFreshQuery;
try {
  await client.query(api.chat.latestMessages, { channelId: channel._id, limit: 25 });
  sameClientFreshQuery = { denied: false };
} catch (error) {
  sameClientFreshQuery = {
    denied: true,
    unauthenticated: String(error).includes("UNAUTHENTICATED"),
    errorClass: String(error).includes("UNAUTHENTICATED") ? "UNAUTHENTICATED" : "OTHER",
  };
}

const anonymous = new ConvexHttpClient(url);
let brandNewAnonymousQuery;
try {
  await anonymous.query(api.chat.latestMessages, { channelId: channel._id, limit: 25 });
  brandNewAnonymousQuery = { denied: false };
} catch (error) {
  brandNewAnonymousQuery = {
    denied: true,
    unauthenticated: String(error).includes("UNAUTHENTICATED"),
    errorClass: String(error).includes("UNAUTHENTICATED") ? "UNAUTHENTICATED" : "OTHER",
  };
}

unsubscribe();
client.close();
const result = {
  capturedAt: new Date().toISOString(),
  sdk: "convex 1.42.3",
  target: "official anonymous local Convex deployment",
  endpoint: url,
  operationMode: "read-only diagnosis; no target mutation or cleanup",
  authoritativeLogoutRows,
  officialReactLogout: {
    method: "ConvexReactClient.clearAuth()",
    events,
    watchHadInitialResult: watchInitial !== null,
    watchErrorClass: watchError?.includes("UNAUTHENTICATED") ? "UNAUTHENTICATED" : watchError ? "OTHER" : null,
    sameClientFreshQuery,
    brandNewAnonymousQuery,
  },
};
await writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
