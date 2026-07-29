import { ConvexReactClient } from "convex/react";
import { importJWK, SignJWT } from "jose";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { api } from "../convex/_generated/api.js";

const root = resolve(import.meta.dirname, "..");
const receipt = resolve(root, "..", "receipts/logout-diagnosis-delivery.json");
const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3310";
const privateJwk = JSON.parse(
  await readFile(resolve(root, ".arm-runtime/private-jwk.json"), "utf8"),
);
const privateKey = await importJWK(privateJwk, "RS256");

async function tokenFor(actor) {
  return await new SignJWT({ name: actor[0].toUpperCase() + actor.slice(1) })
    .setProtectedHeader({ alg: "RS256", kid: "llp0102-dev" })
    .setIssuer("https://llp0102-chat-convex.local")
    .setAudience("llp0102-chat-convex")
    .setSubject(actor)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(privateKey);
}

async function actorClient(actor) {
  const client = new ConvexReactClient(url, { logger: false });
  const token = await tokenFor(actor);
  await new Promise((resolveAuth, reject) => {
    const timeout = setTimeout(() => reject(new Error(`auth timeout for ${actor}`)), 5000);
    client.setAuth(async () => token, (authenticated) => {
      if (authenticated) {
        clearTimeout(timeout);
        resolveAuth();
      }
    });
  });
  return client;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const alice = await actorClient("alice");
const bob = await actorClient("bob");
const channel = await bob.query(api.chat.channelBySlug, { slug: "project-alpha" });
const events = [];
let watchError = null;
let sawInitial = false;
const body = `after-clear-auth-${Date.now()}`;

const watch = bob.watchQuery(api.chat.latestMessages, {
  channelId: channel._id,
  limit: 25,
});
const unsubscribe = watch.onUpdate(() => {
  try {
    const rows = watch.localQueryResult();
    sawInitial = true;
    events.push({
      event: "watch-update",
      at: Date.now(),
      rowCount: rows.length,
      containsDiagnosticBody: rows.some((row) => row.body === body),
    });
  } catch (error) {
    watchError = String(error);
    events.push({ event: "watch-error", at: Date.now(), error: watchError });
  }
});

for (let attempt = 0; attempt < 20 && !sawInitial; attempt += 1) {
  await sleep(25);
}
if (!sawInitial) throw new Error("private watch did not establish before logout");

events.push({ event: "clearAuth-called", at: Date.now() });
bob.clearAuth();

let postLogoutQuery;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    await bob.query(api.chat.latestMessages, { channelId: channel._id, limit: 25 });
    await sleep(25);
  } catch (error) {
    postLogoutQuery = {
      denied: true,
      unauthenticated: String(error).includes("UNAUTHENTICATED"),
      error: String(error),
      at: Date.now(),
    };
    break;
  }
}
if (!postLogoutQuery?.unauthenticated) {
  throw new Error("clearAuth did not reach an authoritative unauthenticated barrier");
}

const settlement = await alice.mutation(api.chat.sendMessage, {
  channelId: channel._id,
  body,
});
const authoritativeRows = await alice.query(api.chat.latestMessages, {
  channelId: channel._id,
  limit: 25,
});
await sleep(750);

const deliveredAfterLogout = events.some(
  (event) => event.event === "watch-update" && event.containsDiagnosticBody,
);
const authoritativeRow = authoritativeRows.find((row) => row.body === body);
const result = {
  capturedAt: new Date().toISOString(),
  sdk: "convex 1.42.3",
  target: "official anonymous local Convex deployment",
  endpoint: url,
  operationMode: "minimal Stop-class diagnosis; one uniquely identified Alice message",
  logoutMethod: "ConvexClient.clearAuth()",
  logoutBarrier: postLogoutQuery,
  watchErrorClass: watchError?.includes("UNAUTHENTICATED")
    ? "UNAUTHENTICATED"
    : watchError
      ? "OTHER"
      : null,
  authoritativeCommit: {
    settlement,
    row: authoritativeRow
      ? {
          id: authoritativeRow._id,
          body: authoritativeRow.body,
          sequence: authoritativeRow.sequence,
          authorSubject: authoritativeRow.authorSubject,
          sentAt: authoritativeRow.sentAt,
          creationTime: authoritativeRow._creationTime,
        }
      : null,
  },
  alreadyConnectedClient: true,
  deliveredAfterLogout,
  events,
  conclusion: deliveredAfterLogout
    ? "STOP_CLASS_CONFIRMED"
    : "ORIGINAL_STOP_WAS_HARNESS_ERROR",
};

unsubscribe();
bob.close();
alice.close();
await writeFile(receipt, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (deliveredAfterLogout || !authoritativeRow) process.exitCode = 1;
