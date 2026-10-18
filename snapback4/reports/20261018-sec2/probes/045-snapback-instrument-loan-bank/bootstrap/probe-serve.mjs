import {startProduction} from './sec2-production.mjs';
// probe:serve — starts the backend + built frontend, signs in two real users
// of every role over password auth, and prints ONE JSON line on stdout.
// Stays up until SIGTERM. Never prints service keys.
import { existsSync } from "node:fs";
import { startDev, startStatic, command, cleanup } from "snapback4/proof";
import { signup, login } from "snapback4/auth";
import { createClient, idFrom } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const log = (...args) => console.error(...args);
process.on("SIGTERM", () => cleanup(() => web?.stop(), () => dev.stop()).finally(() => process.exit(0)));

let dev;
let web;
try {
  dev = await startProduction();
  log(`probe backend ${dev.url}`);

  const ACCOUNTS = [
    ["student", "probe-student-1"], ["student", "probe-student-2"],
    ["parent", "probe-parent-1"], ["parent", "probe-parent-2"],
    ["librarian", "probe-librarian-1"], ["librarian", "probe-librarian-2"],
    ["manager", "probe-manager-1"], ["manager", "probe-manager-2"],
    ["luthier", "probe-luthier-1"], ["luthier", "probe-luthier-2"],
  ];
  const sessions = { student: [], parent: [], librarian: [], manager: [], luthier: [] };
  for (const [role, name] of ACCOUNTS) {
    const emailAddr = `${name}@example.test`;
    const r = await signup(dev.url, emailAddr, "Probe-pass-123!");
    if (!r.ok) throw new Error(`signup ${emailAddr}: ${r.why.message}`);
    sessions[role].push({ user: emailAddr, principal: r.session.principal, token: r.session.token });
  }
  const operator = createClient({url: dev.url, token: dev.token('ops')});
  for (const [role, accounts] of Object.entries(sessions)) for (const account of accounts) {
    const result = await operator.mutate(api.sec2Provision, {who: account.principal, role});
    if (result.state !== 'sent') throw Error('operator provisioning refused');
  }
  await operator.close();

  // Sanity: a seeded librarian can act. Use a throwaway login session, never
  // one of the printed credentials: loading a session into a client lets it
  // rotate (invalidating the printed token), and a forged short expiresAt
  // makes that rotation happen fast.
  const probeLogin = await login(dev.url, "probe-librarian-1@example.test", "Probe-pass-123!");
  if (!probeLogin.ok) throw new Error(`sanity login: ${probeLogin.why.message}`);
  const probe = createClient({ url: dev.url, session: probeLogin.session });
  try {
    const me = await probe.query(api.myRole, {});
    if (!me || !("data" in me) || me.data?.role !== "librarian") throw new Error(`role sanity: ${JSON.stringify(me)}`);
  } finally {
    await probe.signOut().catch(() => {});
  }

  if (!existsSync("dist/index.html")) {
    log("probe: building frontend…");
    const build = await command("npm", ["run", "build"], { timeoutMs: 300_000 });
    if (build.code !== 0) throw new Error(`build failed: ${build.stderr}`);
  }
  web = await startStatic("dist");
  log(`probe frontend ${web.url}`);

  const frontendUrl = `${web.url}/?api=${encodeURIComponent(dev.url)}`;
  console.log(JSON.stringify({
    backendUrl: dev.url,
    frontendUrl,
    sessions,
    apiNotes: "Password sessions from snapback4/auth (/auth/signup, /auth/login). Authenticate with header 'Authorization: Bearer <token>'. Queries: POST {backendUrl}/q/<name> with JSON {\"args\": {...}} (cursor pages take {\"args\": {}} first). Mutations: POST {backendUrl}/m/<name> with JSON {\"id\": \"<unique-intent-id>\", \"args\": {...}}. Queries answer {\"data\", \"complete\", ...} or {\"denied\": {\"code\", \"message\"}}; mutations answer {\"state\": \"sent\", \"result\": ...} or {\"state\": \"failed\", \"why\": {\"code\", \"message\"}}. Sessions last 7 days, well past the 90-minute minimum. Op names: catalog, seasonsList, myRole, myLoans, myCurrent, myOverdue, myDeposits, allLoans, overdueLoans, depositRecords, notesFor, assignRole, createSeason, addInstrument, checkout, checkin, writeOff, recordDeposit, addRepairNote.",
  }));

  await new Promise(() => {});
} catch (error) {
  log(String(error?.stack ?? error));
  await cleanup(() => web?.stop(), () => dev?.stop());
  process.exit(1);
}
