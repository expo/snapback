// Shared production helpers: real users, snapshots, migration math. Raw
// fetch is used for app operations so the same code works against v1 and v2.
import { deploy, rollback, startServe, startStatic, cleanup, cli, command } from "snapback4/proof";
import { signup, login } from "snapback4/auth";

export const DIR = "./deploy";
export const ROLES = ["coach", "matchmaker", "boxer", "physician", "inspector"];
export const PASSWORD = "Day2-Clubhouse-2026!Box";
const DAY = 86400_000;
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const emailFor = (role, i) => `day2-${role}-${i}@example.test`;

export async function post(url, path, session, args) {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.token}` },
    body: JSON.stringify({ args }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  return { status: res.status, body };
}

export async function ensureAccount(url, operatorToken, role, i) {
  const email = emailFor(role, i);
  let session = null;
  const logged = await login(url, email, PASSWORD);
  if (logged.ok) {
    session = logged.session;
  } else {
    const made = await signup(url, email, PASSWORD);
    if (!made.ok) throw Error(`cannot create ${email}: ${JSON.stringify(made)}`);
    session = made.session;
  }
  const mine = await post(url, "/q/myRole", session, {});
  if (mine.body?.data == null) {
    const op = await post(url, "/m/provision", { token: operatorToken }, { principal: session.principal, role });
    if (op.body?.state !== "sent") throw Error(`provision ${email}: ${JSON.stringify(op.body)}`);
    const again = await post(url, "/q/myRole", session, {});
    if (again.body?.data?.role !== role) throw Error(`role missing for ${email}`);
  }
  return { email, password: PASSWORD, principal: session.principal, token: session.token };
}

export async function ensureProdUsers(url, operatorToken) {
  const users = {};
  for (const role of ROLES) {
    users[role] = [];
    for (let i = 1; i <= 2; i++) users[role].push(await ensureAccount(url, operatorToken, role, i));
  }
  return users;
}

export async function tableSnapshot(table, limit = 100000) {
  const r = await cli(["data", table, "--release", DIR, "--json", "--limit", String(limit)]);
  if (r.code !== 0) throw Error(`data ${table}: ${r.stderr.slice(0, 400)}`);
  const parsed = JSON.parse(r.stdout);
  if (parsed.more) throw Error(`data ${table}: truncated at limit ${limit}`);
  const map = new Map();
  for (const row of parsed.rows) map.set(row.id, row);
  return map;
}

export async function fullSnapshot() {
  const out = {};
  for (const t of ["roles", "boxers", "exams", "bouts"]) out[t] = await tableSnapshot(t);
  return out;
}

export function stableRow(row) {
  const sorted = {};
  for (const k of Object.keys(row).sort()) sorted[k] = row[k];
  return JSON.stringify(sorted);
}

// Change-request migration rule: previously competed iff the boxer appears
// in at least one completed bout, regardless of the result.
const refId = (v) => (typeof v === "object" && v !== null ? v.id : v);
export function expectedExperience(boxerId, bouts) {
  for (const bout of bouts.values()) {
    if (bout.status !== "completed") continue;
    if (refId(bout.boxerA) === boxerId || refId(bout.boxerB) === boxerId) return "previously competed";
  }
  return "debut";
}

export function summarizeIds(map) {
  return [...map.keys()].sort();
}

// Matchmaker reconciliation: bring every boxer's label to the
// change-request rule (idempotent). Needed after any v2 activation because
// bouts completed while v1 was live could not flip labels by themselves.
export async function reconcileLabels(url, matchmaker) {
  const snap = await fullSnapshot();
  let corrected = 0;
  for (const [id, row] of snap.boxers) {
    const exp = expectedExperience(id, snap.bouts);
    if (row.experience !== exp) {
      const r = await post(url, "/m/setExperience", matchmaker, { boxer: id, experience: exp });
      if (r.body?.state !== "sent") throw Error(`reconcile ${id}: ${JSON.stringify(r.body).slice(0, 200)}`);
      corrected++;
    }
  }
  return { checked: snap.boxers.size, corrected };
}

export async function uploadScan(url, token) {
  const res = await fetch(`${url}/assets`, {
    method: "POST",
    headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
    body: Buffer.from(PNG_B64, "base64"),
  });
  const body = await res.json();
  if (!res.ok || !body.asset?.id) throw Error(`upload failed: ${JSON.stringify(body)}`);
  return { id: body.asset.id };
}

export { deploy, rollback, startServe, startStatic, cleanup, cli, command, signup, login, DAY };
