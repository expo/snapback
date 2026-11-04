// Replays every frontend call against a running backend as the given users.
// Env: BACKEND_URL, CALLS_USERS (JSON file shaped like probe:serve sessions).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "snapback4/client";
import { login } from "snapback4/auth";
import { api } from "../snapback/generated/api.ts";

const url = process.env.BACKEND_URL;
const usersPath = process.env.CALLS_USERS;
if (!url || !usersPath) {
  console.error("client:calls needs BACKEND_URL and CALLS_USERS");
  process.exit(2);
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const tag = `C${Date.now().toString(36)}`;
const S = JSON.parse(readFileSync(usersPath, "utf8"));
const results = [];
const line = (op, role, ok, error) => {
  const row = { op, role, ok, ...(ok ? {} : { error: String(error ?? "failed") }) };
  results.push(row);
  console.log(JSON.stringify(row));
};
const clients = {};
const tokens = {};
const signIn = async (role, i) => {
  const u = S[role]?.[i];
  assert.ok(u?.email && u?.password, `missing ${role}[${i}] credentials`);
  const res = await login(url, u.email, u.password);
  assert.ok(res.ok, `login ${role}[${i}]: ${res.ok ? "" : res.why.message}`);
  tokens[`${role}${i}`] = res.session.token;
  clients[`${role}${i}`] = createClient({ url, session: res.session });
  return clients[`${role}${i}`];
};
const tryQuery = async (op, role, client, args, label) => {
  try {
    const r = await client.query(op, args);
    if ("denied" in r) line(label ?? op.name ?? "query", role, false, r.denied.code);
    else line(label ?? op.name ?? "query", role, true);
    return r;
  } catch (error) { line(label ?? op.name ?? "query", role, false, error?.message ?? error); return null; }
};
const tryMutate = async (op, role, client, args, label) => {
  try {
    const r = await client.mutate(op, args);
    if (r.state === "sent") line(label ?? op.name ?? "mutation", role, true);
    else line(label ?? op.name ?? "mutation", role, false, r.why.code);
    return r;
  } catch (error) { line(label ?? op.name ?? "mutation", role, false, error?.message ?? error); return null; }
};

try {
  for (const role of ["coach", "matchmaker", "boxer", "physician", "inspector"]) await signIn(role, 0);
  await signIn("boxer", 1);
  if (S.boxer?.[2]) {
    const bx3 = await signIn("boxer", 2);
    const mine3 = await bx3.query(api.myBoxer, {});
    if ("data" in mine3 && !mine3.data) {
      await tryMutate(api.registerBoxer, "boxer", bx3, { name: `Client ${tag} C`, weightLb: 170 });
    } else {
      await tryMutate(api.updateMyProfile, "boxer", bx3, { weightLb: 171 });
    }
  }
  const coach = clients.coach0, mm = clients.matchmaker0, bx1 = clients.boxer0, bx2 = clients.boxer1,
    ph = clients.physician0, insp = clients.inspector0;

  await tryQuery(api.myRole, "coach", coach, {});
  await tryQuery(api.myRole, "matchmaker", mm, {});
  await tryQuery(api.myRole, "boxer", bx1, {});
  await tryQuery(api.myRole, "physician", ph, {});
  await tryQuery(api.myRole, "inspector", insp, {});

  // Boxer profiles: register whoever lacks one, update the other.
  let boxerA = null, boxerB = null;
  const mine1 = await bx1.query(api.myBoxer, {});
  if ("data" in mine1 && mine1.data) {
    boxerA = mine1.data.id;
    await tryMutate(api.updateMyProfile, "boxer", bx1, { weightLb: 150 + (Date.now() % 20) });
  } else {
    const r = await tryMutate(api.registerBoxer, "boxer", bx1, { name: `Client ${tag} A`, weightLb: 150 });
    if (r?.state === "sent") boxerA = r.result.id;
  }
  const mine2 = await bx2.query(api.myBoxer, {});
  if ("data" in mine2 && mine2.data) {
    boxerB = mine2.data.id;
    await tryMutate(api.updateMyProfile, "boxer", bx2, { weightLb: 160 });
  } else {
    const r = await tryMutate(api.registerBoxer, "boxer", bx2, { name: `Client ${tag} B`, weightLb: 160 });
    if (r?.state === "sent") boxerB = r.result.id;
  }
  if (!boxerA || !boxerB) {
    line("registerBoxer", "boxer", false, "missing boxer records");
    throw Error("boxer records missing");
  }
  await tryQuery(api.boxersList, "coach", coach, {});
  await tryQuery(api.boxersList, "boxer", bx1, {});
  await tryQuery(api.boxerCard, "coach", coach, { boxer: boxerA });
  await tryQuery(api.boxerCard, "physician", ph, { boxer: boxerA });
  await tryQuery(api.boxerCard, "inspector", insp, { boxer: boxerA });
  // v1 client: no experience label calls.
  await tryQuery(api.myBoxer, "boxer", bx1, {});
  await tryQuery(api.examsOf, "physician", ph, { boxer: boxerA });
  await tryQuery(api.examsOf, "boxer", bx1, { boxer: boxerA });
  await tryQuery(api.boutCard, "matchmaker", mm, {});
  await tryQuery(api.boutCard, "boxer", bx1, {});
  await tryQuery(api.eligibility, "matchmaker", mm, { boxer: boxerA });

  // Uploads go over the documented raw POST /assets wire call with the user's
  // own session Bearer [REDACTED] (the same bytes client.upload sends); the Node SDK
  // upload wrapper refuses these bytes, so this uses the same endpoint directly.
  const freshScan = async (token) => {
    const res = await fetch(`${url}/assets`, { method: "POST", headers: { "content-type": "image/png", authorization: `Bearer ${token}` }, body: PNG });
    const body = await res.json();
    assert.ok(res.ok && body.asset?.id, `upload: ${JSON.stringify(body).slice(0, 160)}`);
    return { id: body.asset.id };
  };
  await tryMutate(api.recordExam, "physician", ph, { boxer: boxerA, takenAt: Date.now(), scan: await freshScan(tokens.physician0) });
  await tryMutate(api.recordExam, "physician", ph, { boxer: boxerB, takenAt: Date.now(), scan: await freshScan(tokens.physician0) });
  await tryMutate(api.setNotes, "physician", ph, { boxer: boxerA, notes: `Client note ${tag}` });

  // Self-healing on the real clock: a previous interrupted run may have left
  // a suspension behind (30 real days); clear it before proposing.
  for (const id of [boxerA, boxerB]) {
    const card = await insp.query(api.boxerCard, { boxer: id });
    if ("data" in card && card.data?.suspensionUntil > Date.now()) {
      await tryMutate(api.liftSuspension, "inspector", insp, { boxer: id });
    }
  }
  const p1 = await tryMutate(api.proposeBout, "matchmaker", mm, { boxerA, boxerB, boutAt: Date.now() + 7 * 86400_000, venue: `Client Venue ${tag}` });
  const boutA = p1?.state === "sent" ? p1.result.id : null;
  if (boutA) {
    await tryMutate(api.confirmBout, "matchmaker", mm, { bout: boutA });
    await tryMutate(api.recordResult, "physician", ph, { bout: boutA, method: "decision" });
  } else {
    line("confirmBout", "matchmaker", false, "no bout to confirm");
    line("recordResult", "physician", false, "no bout to decide");
  }
  const p2 = await tryMutate(api.proposeBout, "matchmaker", mm, { boxerA, boxerB, boutAt: Date.now() + 14 * 86400_000, venue: `Client Venue 2 ${tag}` });
  const boutB = p2?.state === "sent" ? p2.result.id : null;
  if (boutB) {
    await tryMutate(api.cancelBout, "matchmaker", mm, { bout: boutB });
  } else {
    line("cancelBout", "matchmaker", false, "no bout to cancel");
  }
  const p3 = await tryMutate(api.proposeBout, "matchmaker", mm, { boxerA, boxerB, boutAt: Date.now() + 21 * 86400_000, venue: `Client Venue 3 ${tag}` });
  const boutC = p3?.state === "sent" ? p3.result.id : null;
  if (boutC) {
    await tryMutate(api.confirmBout, "matchmaker", mm, { bout: boutC });
    const stop = await tryMutate(api.recordResult, "physician", ph, { bout: boutC, stoppedBoxer: boxerB, stoppedAt: Date.now(), reason: `Client stoppage ${tag}` });
    if (stop?.state === "sent") await tryMutate(api.liftSuspension, "inspector", insp, { boxer: boxerB });
    else line("liftSuspension", "inspector", false, "no suspension to lift");
  } else {
    line("confirmBout", "matchmaker", false, "no bout to confirm");
    line("recordResult", "physician", false, "no bout for stoppage");
    line("liftSuspension", "inspector", false, "no suspension to lift");
  }
} catch (error) {
  console.error(`client:calls aborted: ${error?.message ?? error}`);
}
const failed = results.filter((r) => !r.ok);
console.error(`client:calls: ${results.length - failed.length}/${results.length} succeeded`);
process.exit(failed.length ? 1 : 0);
