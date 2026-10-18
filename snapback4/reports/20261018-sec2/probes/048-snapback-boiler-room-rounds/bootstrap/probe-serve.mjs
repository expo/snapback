import { startProduction } from './sec2-production.mjs';
// probe:serve — production-shaped serving for the security review.
// Deploys the schema, serves it with `serve` (personas refused, seed/dev
// doors closed — exactly what real users hit), builds + serves the UI, signs
// up (or back in to) two users per role with real passwords, grants roles
// through the service:ops seat (the documented first-admin path), stages a
// demo shift/gauges/round, then prints one JSON line and stays up.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { deploy, startServe, startStatic, command, cli, cleanup } from "snapback4/proof";

const err = (...args) => console.error(...args);
const H = (token) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const PASSWORD = "Probe-serve-password-1!";
const USERS = [
  ["engineer", "probe-eng1"], ["engineer", "probe-eng2"],
  ["chief", "probe-chief1"], ["chief", "probe-chief2"],
  ["contractor", "probe-con1"], ["contractor", "probe-con2"],
  ["manager", "probe-mgr1"], ["manager", "probe-mgr2"],
];

async function signupOrLogin(url, name) {
  const email = `${name}@example.test`;
  const body = JSON.stringify({ email, password: PASSWORD });
  let res = await fetch(`${url}/auth/signup`, {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
  let parsed = await res.json();
  if (!res.ok || !parsed.session) {
    res = await fetch(`${url}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body,
    });
    parsed = await res.json();
  }
  assert.ok(parsed.session?.token, `no session for ${email}: ${JSON.stringify(parsed)}`);
  return { email, principal: parsed.session.principal, token: parsed.session.token };
}

async function m(url, token, op, args) {
  const res = await fetch(`${url}/m/${op}`, {
    method: "POST", headers: H(token), body: JSON.stringify({ args }),
  });
  return res.json();
}

async function q(url, token, op, args) {
  const res = await fetch(`${url}/q/${op}`, {
    method: "POST", headers: H(token), body: JSON.stringify({ args }),
  });
  return res.json();
}

await (async () => {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("logs/probe.pid", String(process.pid));
  if (!existsSync("dist/index.html")) {
    err("probe: building dist…");
    const build = await command("npm", ["run", "build"], { timeoutMs: 300_000 });
    assert.equal(build.code, 0, `probe build failed: ${build.stderr}`);
  }
  err("probe: deploying schema…");
  const backend = await startProduction();
  let frontend = null;
  const stop = () => cleanup(() => frontend?.stop(), () => backend.stop());
  for (const sig of ["SIGTERM", "SIGINT"]) {
    process.once(sig, () => { void stop().then(() => process.exit(0)); });
  }
  try {
    frontend = await startStatic("dist");
    const url = backend.url;
    err(`probe: backend ${url} frontend ${frontend.url}`);

    const serviceToken = backend.token("ops");
    assert.ok(serviceToken, "service token minted");

    const sessions = { engineer: [], chief: [], contractor: [], manager: [] };
    const byRole = { engineer: [], chief: [], contractor: [], manager: [] };
    for (const [role, name] of USERS) {
      const u = await signupOrLogin(url, name);
      byRole[role].push(u);
      const granted = await m(url, serviceToken, "assignRole", { who: u.principal, role });
      assert.equal(granted.state, "sent", `assignRole ${name}: ${JSON.stringify(granted)}`);
      sessions[role].push({ user: u.email, headers: { Authorization: `Bearer ${u.token}` } });
    }

    // Stage demo content with chief1 (idempotent on repeat runs).
    const chief = byRole.chief[0].token;
    const engA = byRole.engineer[0].principal;
    const engB = byRole.engineer[1].principal;
    const conA = byRole.contractor[0].principal;
    const conB = byRole.contractor[1].principal;
    async function ensureGauge(name, location) {
      const gauges = await q(url, chief, "gaugesList", {});
      const found = gauges.data?.find((g) => g.name === name)?.id;
      if (found) return found;
      return (await m(url, chief, "addGauge", {
        name, location,
        minPressure: 300, maxPressure: 800, minTemp: 60, maxTemp: 120,
      })).result.id;
    }
    const g1 = await ensureGauge("Probe Boiler A", "Basement B1");
    const g2 = await ensureGauge("Probe Boiler B", "Basement B2");
    for (const [gaugeId, contractor] of [[g1, conA], [g2, conB]]) {
      const current = await q(url, chief, "gaugeAssignments", { gaugeId });
      if (!current.data?.some((a) => a.contractor === contractor)) {
        await m(url, chief, "assignContractor", { gaugeId, contractor });
      }
    }
    const shifts = await q(url, chief, "shiftsList", {});
    let shift = shifts.data?.[0]?.id;
    if (!shift) {
      const now = Date.now();
      shift = (await m(url, chief, "createShift", {
        label: "Probe shift", startsAt: now - 2 * 3_600_000, endsAt: now + 10 * 3_600_000,
      })).result.id;
      await m(url, chief, "addShiftMember", { shiftId: shift, engineer: engA });
      await m(url, chief, "addShiftMember", { shiftId: shift, engineer: engB });
      await m(url, chief, "assignContractor", { gaugeId: g1, contractor: conA });
      await m(url, chief, "scheduleRound", { shiftId: shift, scheduledAt: now - 15 * 60_000 });
    }

    const out = {
      backendUrl: url,
      frontendUrl: frontend.url,
      sessions,
      apiNotes: "JSON over HTTP: POST /q/<query> and /m/<mutation> with body {\"args\":{...}} and header Authorization: Bearer <session token>; mutations answer {state:\"sent\"|\"failed\"}. Photos: POST /assets with raw image bytes, then pass {id} to logReading; GET /assets/<id> serves bytes the caller's read rule admits. Password signup/login at POST /auth/signup and /auth/login. Sessions last 7 days.",
    };
    console.log(JSON.stringify(out));
    await new Promise(() => {});
  } finally {
    await stop();
  }
})();
