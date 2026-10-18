import { startProduction } from './sec2-production.mjs';
// Tow Yard Release probe:serve. Deploys the schema (durable store in
// ./deployment), serves the production backend (serve refuses personas and
// seed doors) plus the built app, signs in real users of every role through
// the password path, prints ONE JSON line on stdout, and stays up until the
// harness kills the process group (SIGTERM). All other output goes to stderr.
// Service/operator tokens never leave this process.
import { mintId } from "snapback4/client";
import { cli, command, startServe, startStatic, cleanup } from "snapback4/proof";
import {
  api, ensureRegistered, sent, closeAll,
} from "./lib.mjs";

const err = (...args) => console.error(...args);
const options = { logsDir: "logs" };
const PROBE_PASSWORD = "Tow-yard-probe-4816!";
const users = [];
let serve;
let web;

async function serviceGrant(backendUrl, serviceToken, who, role) {
  const res = await fetch(`${backendUrl}/m/grantRole`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${serviceToken}` },
    body: JSON.stringify({ id: mintId(), args: { who, role } }),
  });
  const body = await res.json();
  if (body.state !== "sent") {
    throw new Error(`service grantRole ${role} failed: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
}

async function main() {
  // Same password, dedicated probe accounts (signup-or-login: repeatable).
  const { signup, login } = await import("snapback4/auth");
  const { createClient } = await import("snapback4/client");
  async function probeUser(email) {
    let result = await signup(serve.url, email, PROBE_PASSWORD);
    if (!result.ok) result = await login(serve.url, email, PROBE_PASSWORD);
    if (!result.ok) throw new Error(`probe auth failed for ${email}: ${result.why.message}`);
    const client = createClient({ url: serve.url, session: result.session });
    const user = { client, principal: client.viewer(), token: result.session.token, email };
    users.push(user);
    return user;
  }

  err("probe: deploying schema…");


  err("probe: starting production backend…");
  serve = await startProduction();
  err(`probe: backend at ${serve.url}`);

  err("probe: building frontend…");
  const built = await command("npm", ["run", "build"], {
    ...options,
    timeoutMs: 300_000,
    env: { ...process.env, VITE_SNAPBACK_URL: serve.url },
  });
  if (built.code !== 0) throw new Error(`build failed: ${built.stderr.slice(-2000)}`);

  err("probe: starting frontend…");
  web = await startStatic("dist", options);
  err(`probe: frontend at ${web.url}`);

  const owner1 = await probeUser("probe-owner1@example.test");
  const owner2 = await probeUser("probe-owner2@example.test");
  const clerk1 = await probeUser("probe-clerk1@example.test");
  const clerk2 = await probeUser("probe-clerk2@example.test");
  const lia1 = await probeUser("probe-lia1@example.test");
  const lia2 = await probeUser("probe-lia2@example.test");
  const mgr1 = await probeUser("probe-mgr1@example.test");
  const mgr2 = await probeUser("probe-mgr2@example.test");
  const handles = {
    [owner1.principal]: "probeowner1", [owner2.principal]: "probeowner2",
    [clerk1.principal]: "probeclerk1", [clerk2.principal]: "probeclerk2",
    [lia1.principal]: "probelia1", [lia2.principal]: "probelia2",
    [mgr1.principal]: "probemgr1", [mgr2.principal]: "probemgr2",
  };
  for (const u of users) await ensureRegistered(u, handles[u.principal]);

  // First manager through the operator seat (minted locally, never printed);
  // every other role through that manager. Idempotent: re-granting is an
  // update to the same value.
  const serviceToken = serve.token("ops");
  try {
    await serviceGrant(serve.url, serviceToken, mgr1.principal, "manager");
  } finally {
    // Drop the operator Bearer [REDACTED] the moment the bootstrap grant is done.
    for (const key of Object.keys(process.env)) {
      if (/token/i.test(key)) delete process.env[key];
    }
  }
  sent(await mgr1.client.mutate(api.grantRole, { who: mgr2.principal, role: "manager" }), "grant mgr2");
  sent(await mgr1.client.mutate(api.grantRole, { who: clerk1.principal, role: "clerk" }), "grant clerk1");
  sent(await mgr1.client.mutate(api.grantRole, { who: clerk2.principal, role: "clerk" }), "grant clerk2");
  sent(await mgr1.client.mutate(api.grantRole, { who: lia1.principal, role: "liaison" }), "grant lia1");
  sent(await mgr1.client.mutate(api.grantRole, { who: lia2.principal, role: "liaison" }), "grant lia2");

  // Prove every session works against the roles it claims before printing.
  const cred = (u) => ({ user: u.email, principal: u.principal, headers: { Authorization: `Bearer ${u.token}` } });
  const roles = { owner: [owner1, owner2], clerk: [clerk1, clerk2], liaison: [lia1, lia2], manager: [mgr1, mgr2] };
  const expected = { owner: "owner", clerk: "clerk", liaison: "liaison", manager: "manager" };
  for (const [role, pair] of Object.entries(roles)) {
    for (const u of pair) {
      const me = await u.client.query(api.myRole, {});
      if (me.data?.role !== expected[role]) throw new Error(`probe ${u.email} has role ${me.data?.role}, want ${expected[role]}`);
    }
  }

  const frontendUrl = `${web.url}/?api=${encodeURIComponent(serve.url)}`;
  const sessions = Object.fromEntries(
    Object.entries(roles).map(([role, pair]) => [role, pair.map(cred)]),
  );
  process.stdout.write(JSON.stringify({
    backendUrl: serve.url,
    frontendUrl,
    sessions,
    apiNotes: "Password sessions (7-day Bearer [REDACTED] via POST /auth/signup and /auth/login). Queries are POST {backendUrl}/q/<name> with JSON {args}; mutations are POST {backendUrl}/m/<name> with JSON {id, args} where id is a fresh client write id; file uploads are POST {backendUrl}/assets with the file bytes (Content-Type set), whose returned asset id is placed as {id} in the intake photos or fileClaim proof argument. Every call carries Authorization: Bearer <token> from the printed sessions. Quarry operations available: myRole, directory, myVehicles, yardVehicles, holdVehicles, auctionList, vehicleDetail, myClaims, claimsFor, waiversOf, register, grantRole (manager), intake (clerk), fileClaim (owner), decideClaim (clerk), placeHold (clerk), liftHold (liaison), waiveFees (manager), releaseVehicle (clerk); impounded vehicles older than 30 days without a verified claim move to auction via the daily auctionSweep schedule.",
  }) + "\n");

  // Stay up until the harness kills the process group.
  err("probe: serving until SIGTERM");
  await new Promise(() => {});
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  err(`probe: ${signal}, stopping…`);
  try {
    await closeAll(users);
    await cleanup(() => web?.stop(), () => serve?.stop());
  } finally {
    process.exit(0);
  }
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => void shutdown(signal));

main().catch(async (error) => {
  err(`probe failed: ${error?.stack ?? error}`);
  try {
    await closeAll(users);
    await cleanup(() => web?.stop(), () => serve?.stop());
  } finally {
    process.exit(1);
  }
});
