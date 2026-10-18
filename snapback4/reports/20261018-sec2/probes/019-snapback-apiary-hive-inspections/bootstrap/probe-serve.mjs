import {startProduction} from './sec2-production.mjs';
// probe:serve — starts the backend and the web app on this machine's ports
// with real password users of every role, prints one JSON line on stdout,
// and stays up until SIGTERM.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { startDev, startStatic, cleanup } from "snapback4/proof";
import { api } from "../snapback/generated/api.ts";
import { PASSWORD, emailOf, ensureSetup } from "./apiary-lib.mjs";

const log = (...args) => console.error(...args);
const DAY = 86400000;

if (!existsSync("dist/index.html")) {
  log("probe:serve: building web export...");
  execFileSync("npm", ["run", "build:web"], { stdio: ["ignore", "ignore", "inherit"] });
}
const dev = await startProduction();
let web = null;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await cleanup(() => web?.stop(), () => dev.stop());
}
process.once("SIGTERM", () => stop().then(() => process.exit(0)));
process.once("SIGINT", () => stop().then(() => process.exit(0)));
try {
  const { clients, principals } = await ensureSetup(dev.url, process.cwd());
  const now = Date.now();
  const season = { seasonStart: now - 30 * DAY, seasonEnd: now + 90 * DAY };
  const hN = await clients.lead1.mutate(api.createHive, { name: "North Meadow", landOwner: principals.own1, route: "north", ...season });
  const hS = await clients.lead1.mutate(api.createHive, { name: "South Orchard", landOwner: principals.own2, route: "south", ...season });
  if (hN.state === "sent" && hS.state === "sent") {
    await clients.insp1.mutate(api.recordInspection, { hive: hN.result.id, queenStatus: "laying", miteCount: 2, notes: "Calm colony" });
    await clients.own1.mutate(api.addListing, { hive: hN.result.id, title: "Wildflower honey", priceCents: 1200, blurb: "Raw spring honey" });
  }
  web = await startStatic("dist");
  const cred = (name) => {
    const session = clients[name].session();
    return { user: emailOf(name), principal: principals[name], token: session.token, headers: { Authorization: `Bearer ${session.token}` } };
  };
  console.log(JSON.stringify({
    backendUrl: dev.url,
    frontendUrl: `${web.url}/?api=${encodeURIComponent(dev.url)}`,
    sessions: {
      lead: [cred("lead1"), cred("lead2")],
      inspector: [cred("insp1"), cred("insp2")],
      landowner: [cred("own1"), cred("own2")],
    },
    apiNotes: "Password sessions (7-day expiry). Queries: POST {backendUrl}/q/<name> with JSON {args:{...}} and header Authorization: Bearer <token>. Mutations: POST {backendUrl}/m/<name> with JSON {id:<26-char Crockford id, first char 0-7>,args:{...}} and the same header; the reply is sent (with result) or failed (with why.code such as NOT_LEAD or NOT_FOUND). Image uploads: client.upload(bytes) then pass {id} as the photo arg. Operation names: whoAmI, myRole, hive, hives, inspectionsOf, hiveStatus, myAlerts, listings, roster, myRoutes, routeBoard, grantRole, assignRoute, createHive, recordInspection, setHiveStatus, addListing, removeListing.",
  }));
  log(`probe:serve up: backend=${dev.url} frontend=${web.url}`);
  await new Promise(() => {});
} catch (error) {
  log(`probe:serve failed: ${error && error.stack || error}`);
  await stop();
  process.exit(1);
}
