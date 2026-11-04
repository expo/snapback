// Acceptance: real password users, every operation, every refusal in the spec.
// Fresh staging deployment per run, so it passes twice in a row.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { deploy, startServe, cleanup } from "snapback4/proof";
import { createClient } from "snapback4/client";
import { signup, login } from "snapback4/auth";
import { api } from "../snapback/generated/api.ts";

const DIR = ".staging-accept";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const DAY = 86400_000;
let passed = 0;
const ok = (label) => { passed++; console.error(`ok ${passed} - ${label}`); };
const clientFor = (url, a) => createClient({ url, session: { principal: a.principal, token: a.token, expiresAt: a.expiresAt } });
const sent = async (client, op, args, label) => {
  const r = await client.mutate(op, args);
  assert.equal(r.state, "sent", `${label}: expected sent, got ${JSON.stringify(r)}`);
  ok(label);
  return r;
};
const fails = async (client, op, args, code, label) => {
  const r = await client.mutate(op, args);
  assert.equal(r.state, "failed", `${label}: expected failed, got ${JSON.stringify(r)}`);
  assert.equal(r.why.code, code, `${label}: expected ${code}, got ${r.why.code}`);
  ok(`${label} refused ${code}`);
};
const denied = async (client, op, args, code, label) => {
  const r = await client.query(op, args);
  assert.ok("denied" in r, `${label}: expected denial, got ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(r.denied.code, code, `${label}: expected ${code}, got ${r.denied.code}`);
  ok(`${label} denied ${code}`);
};
const uploadScan = async (url, token) => {
  const res = await fetch(`${url}/assets`, { method: "POST", headers: { "content-type": "image/png", authorization: `Bearer ${token}` }, body: PNG });
  const body = await res.json();
  assert.ok(res.ok && body.asset?.id, `upload failed: ${JSON.stringify(body)}`);
  return { id: body.asset.id };
};

rmSync(DIR, { recursive: true, force: true });
await deploy(DIR, "snapback", { args: ["--staging"] });
const host = await startServe(DIR, {
  seedUsers: { roles: { coach: 2, matchmaker: 2, boxer: 2, physician: 2, inspector: 2 }, provision: api.provision },
});
try {
  const S = host.sessions;
  const [coach1, coach2] = S.coach, [mm1, mm2] = S.matchmaker, [bx1, bx2] = S.boxer,
    [ph1, ph2] = S.physician, [in1, in2] = S.inspector;
  const c = (a) => clientFor(host.url, a);
  const cc1 = c(coach1), cc2 = c(coach2), cm1 = c(mm1), cm2 = c(mm2),
    cb1 = c(bx1), cb2 = c(bx2), cp1 = c(ph1), cp2 = c(ph2), ci1 = c(in1), ci2 = c(in2);

  // A. Real auth path: login works, wrong password and duplicate signup refuse.
  const again = await login(host.url, bx1.email, bx1.password);
  assert.ok(again.ok, "login with correct password");
  ok("login works");
  const wrong = await login(host.url, bx1.email, "Wrong-password-000!");
  assert.ok(!wrong.ok, "wrong password must refuse");
  ok("wrong password refused");
  const dup = await signup(host.url, bx1.email, bx1.password);
  assert.ok(!dup.ok, "duplicate signup must refuse");
  ok("duplicate signup refused");
  const fresh = await signup(host.url, `norole-${Date.now()}@example.test`, "No-role-pass-123!");
  assert.ok(fresh.ok, "fresh signup");
  const cNoRole = createClient({ url: host.url, session: fresh.session });
  const noRole = await cNoRole.query(api.myRole, {});
  assert.ok("data" in noRole && noRole.data === null, "user without role has no role row");
  ok("signup grants no role");

  // B. Role roster: everyone reads their own role; only the operator provisions.
  for (const [cl, role] of [[cc1, "coach"], [cm1, "matchmaker"], [cb1, "boxer"], [cp1, "physician"], [ci1, "inspector"]]) {
    const r = await cl.query(api.myRole, {});
    assert.ok("data" in r && r.data?.role === role, `${role} reads own role`);
    ok(`${role} reads own role`);
  }
  await fails(cb1, api.provision, { principal: bx1.principal, role: "coach" }, "NOT_OPERATOR", "boxer self-promotion");
  const opToken = await host.operatorToken();
  const opRes = await fetch(`${host.url}/m/provision`, { method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opToken}` },
    body: JSON.stringify({ args: { principal: bx1.principal, role: "boxer" } }) });
  assert.equal((await opRes.json()).state, "sent", "operator re-provision idempotent");
  ok("operator provision idempotent");

  // C. Registration: boxers self-register once; coaches cannot.
  const reg1 = await sent(cb1, api.registerBoxer, { name: "Aldo Reyes", weightLb: 150 }, "boxer1 registers");
  const reg2 = await sent(cb2, api.registerBoxer, { name: "Beto Sanz", weightLb: 165 }, "boxer2 registers");
  const boxerA = reg1.result.id, boxerB = reg2.result.id;
  ok("both boxers registered");
  await fails(cb1, api.registerBoxer, { name: "Again", weightLb: 150 }, "E_UNIQUE", "duplicate profile");
  await fails(cc1, api.registerBoxer, { name: "Coach Boxer", weightLb: 150 }, "NOT_BOXER", "coach registers");
  await sent(cb1, api.updateMyProfile, { weightLb: 152 }, "boxer1 updates weight");
  const mine = await cb1.query(api.myBoxer, {});
  assert.ok("data" in mine && mine.data?.weightLb === 152, "weight updated");
  ok("boxer updates own profile");
  const mine2 = await cb2.query(api.myBoxer, {});
  assert.ok("data" in mine2 && mine2.data?.id === boxerB, "boxer2 sees only own profile");
  ok("boxer2 sees only own profile");

  // C2. Experience label: new boxers debut; only the matchmaker may change it.
  for (const [client, id] of [[cb1, boxerA], [cb2, boxerB]]) {
    const card = await client.query(api.myBoxer, {});
    assert.ok("data" in card && card.data?.experience === "debut", "new boxer debuts");
  }
  ok("new boxers debut");
  const coachCard = await cc1.query(api.boxerCard, { boxer: boxerA });
  assert.ok("data" in coachCard && coachCard.data?.experience === "debut", "coach sees label beside record");
  ok("coach sees experience label");
  await fails(cc1, api.setExperience, { boxer: boxerA, experience: "previously competed" }, "NOT_MATCHMAKER", "coach sets label");
  await fails(cb1, api.setExperience, { boxer: boxerA, experience: "previously competed" }, "NOT_MATCHMAKER", "boxer sets own label");
  await fails(cp1, api.setExperience, { boxer: boxerA, experience: "previously competed" }, "NOT_MATCHMAKER", "physician sets label");
  await fails(ci1, api.setExperience, { boxer: boxerA, experience: "previously competed" }, "NOT_MATCHMAKER", "inspector sets label");
  await fails(cm1, api.setExperience, { boxer: boxerA, experience: "rookie" }, "E_INPUT", "bad label value");
  await sent(cm1, api.setExperience, { boxer: boxerA, experience: "previously competed" }, "matchmaker sets label");
  const relabelled = await cm1.query(api.boxerCard, { boxer: boxerA });
  assert.ok("data" in relabelled && relabelled.data?.experience === "previously competed", "label updated");
  ok("matchmaker label change visible");
  await sent(cm1, api.setExperience, { boxer: boxerA, experience: "debut" }, "matchmaker resets label");
  await fails(cb1, api.updateMyProfile, { weightLb: 152, experience: "previously competed" }, "E_INPUT", "profile update smuggles label");

  // D. Exams: physician records, one backdated 400 days (expired).
  const scan1 = await uploadScan(host.url, ph1.token);
  await sent(cp1, api.recordExam, { boxer: boxerA, takenAt: Date.now(), scan: scan1, resultNotes: "Fit to box" }, "fresh exam boxerA");
  ok("physician records exam with scan");
  const scan2 = await uploadScan(host.url, ph2.token);
  await sent(cp2, api.recordExam, { boxer: boxerB, takenAt: Date.now() - 400 * DAY, scan: scan2 }, "backdated exam boxerB");
  await fails(cc1, api.recordExam, { boxer: boxerA, takenAt: Date.now(), scan: await uploadScan(host.url, ph1.token) }, "NOT_PHYSICIAN", "coach records exam");
  const eligA = await cm1.query(api.eligibility, { boxer: boxerA });
  assert.ok("data" in eligA && eligA.data.examValid === true && eligA.data.suspended === false, "boxerA eligible");
  ok("fresh exam is valid");
  const eligB = await cm1.query(api.eligibility, { boxer: boxerB });
  assert.ok("data" in eligB && eligB.data.examValid === false, "boxerB exam expired");
  ok("400-day-old exam is expired");
  const exBbyB = await cb2.query(api.examsOf, { boxer: boxerB });
  assert.ok("data" in exBbyB && exBbyB.data.length === 1, "boxer sees own exam history");
  ok("boxer sees own exam history");
  const exAbyB = await cb2.query(api.examsOf, { boxer: boxerA });
  assert.ok("data" in exAbyB && exAbyB.data.length === 0, "boxer sees no other boxer's history");
  ok("boxer sees no other boxer history");

  // E. Notes privacy: only physician + inspector read them.
  await sent(cp1, api.setNotes, { boxer: boxerA, notes: "Cut above left eye, heals well" }, "physician notes");
  await fails(cc1, api.setNotes, { boxer: boxerA, notes: "x" }, "NOT_PHYSICIAN", "coach writes notes");
  const seenBy = async (client, label, expect) => {
    const r = await client.query(api.boxerCard, { boxer: boxerA });
    assert.ok("data" in r && r.data, `${label} reads card`);
    const has = "physicianNotes" in r.data;
    assert.equal(has, expect, `${label} notes visibility`);
    ok(`${label} ${expect ? "sees" : "does not see"} physician notes`);
    return r.data;
  };
  await seenBy(cb1, "own boxer", false);
  await seenBy(cc1, "coach", false);
  await seenBy(cm1, "matchmaker", false);
  await seenBy(cp2, "second physician", true);
  const inspView = await seenBy(ci1, "inspector", true);
  assert.equal(inspView.suspensionReason ?? null, null, "no suspension yet");
  const hidden = await cb2.query(api.boxerCard, { boxer: boxerA });
  assert.ok("data" in hidden && hidden.data === null, "other boxer reads null");
  ok("other boxer reads null card");

  // F. Bout flow: propose, refused confirm while exam expired, then confirm.
  const now = Date.now();
  await fails(cc1, api.proposeBout, { boxerA, boxerB, boutAt: now + 7 * DAY, venue: "Main Hall" }, "NOT_MATCHMAKER", "coach proposes");
  await fails(cm1, api.proposeBout, { boxerA, boxerB: boxerA, boutAt: now + 7 * DAY, venue: "Main Hall" }, "SAME_BOXER", "same boxer");
  await fails(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now - DAY, venue: "Main Hall" }, "BOUT_IN_PAST", "past bout");
  const p1 = await sent(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now + 7 * DAY, venue: "Main Hall" }, "propose bout1");
  const bout1 = p1.result.id;
  const card1 = await cb2.query(api.boutCard, {});
  assert.ok("data" in card1 && card1.data.some((b) => b.id === bout1 && b.status === "proposed"), "card shows proposed");
  ok("bout card shows proposed bout");
  await fails(cc1, api.confirmBout, { bout: bout1 }, "NOT_MATCHMAKER", "coach confirms");
  await fails(cm1, api.confirmBout, { bout: bout1 }, "EXAM_EXPIRED", "confirm with expired exam");
  const scan3 = await uploadScan(host.url, ph2.token);
  await sent(cp2, api.recordExam, { boxer: boxerB, takenAt: Date.now(), scan: scan3 }, "fresh exam boxerB");
  await sent(cm2, api.confirmBout, { bout: bout1 }, "confirm bout1");
  const card2 = await cb1.query(api.boutCard, {});
  assert.ok("data" in card2 && card2.data.some((b) => b.id === bout1 && b.status === "confirmed"), "card shows confirmed");
  ok("bout card updates live on confirm");

  // G. Stoppage suspends 30 days; only the inspector lifts early.
  await fails(cm1, api.recordResult, { bout: bout1, method: "decision" }, "NOT_PHYSICIAN", "matchmaker records result");
  await sent(cp1, api.recordResult, { bout: bout1, stoppedBoxer: boxerB, method: "TKO", stoppedAt: Date.now(), reason: "Knocked down twice" }, "stoppage recorded");
  const expA = await cm1.query(api.boxerCard, { boxer: boxerA });
  assert.ok("data" in expA && expA.data?.experience === "previously competed", "completed bout flips boxerA label");
  const expB = await cm1.query(api.boxerCard, { boxer: boxerB });
  assert.ok("data" in expB && expB.data?.experience === "previously competed", "stoppage flips boxerB label");
  ok("labels stay consistent as bouts are recorded");
  const suspCoach = await cc1.query(api.boxerCard, { boxer: boxerB });
  assert.ok("data" in suspCoach && suspCoach.data, "coach reads suspended card");
  const until = suspCoach.data.suspensionUntil;
  assert.ok(until && Math.abs(until - (Date.now() + 30 * DAY)) < 120_000, "suspended ~30 days");
  assert.ok(!("suspensionReason" in suspCoach.data), "reason hidden from coach");
  ok("suspension set, reason hidden from coach");
  const suspPhys = await cp1.query(api.boxerCard, { boxer: boxerB });
  assert.ok("data" in suspPhys && suspPhys.data?.suspensionReason === "Knocked down twice", "physician sees reason");
  ok("physician sees suspension reason");
  const p2 = await sent(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now + 14 * DAY, venue: "Annex" }, "propose bout2");
  const bout2 = p2.result.id;
  await fails(cm1, api.confirmBout, { bout: bout2 }, "BOXER_SUSPENDED", "confirm suspended boxer");
  await fails(cm1, api.liftSuspension, { boxer: boxerB }, "NOT_INSPECTOR", "matchmaker lifts");
  await sent(ci2, api.liftSuspension, { boxer: boxerB }, "inspector lifts early");
  await fails(ci2, api.liftSuspension, { boxer: boxerB }, "NO_SUSPENSION", "lift with none set");
  await sent(cm1, api.confirmBout, { bout: bout2 }, "confirm after lift");
  await sent(cp2, api.recordResult, { bout: bout2, method: "decision" }, "decision result");
  await fails(cm2, api.recordResult, { bout: bout2, method: "decision" }, "NOT_PHYSICIAN", "result on completed");
  const p3 = await sent(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now + 21 * DAY, venue: "Annex" }, "propose bout3");
  await sent(cm1, api.cancelBout, { bout: p3.result.id }, "cancel bout3");
  await fails(cm1, api.confirmBout, { bout: p3.result.id }, "BAD_STATUS", "confirm cancelled");
  // A 31-day-old stoppage has already lapsed: no suspension blocks the next bout.
  const p4 = await sent(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now + 28 * DAY, venue: "Old Hall" }, "propose bout4");
  await sent(cm1, api.confirmBout, { bout: p4.result.id }, "confirm bout4");
  await sent(cp1, api.recordResult, { bout: p4.result.id, stoppedBoxer: boxerA, stoppedAt: now - 31 * DAY, reason: "Old cut" }, "old stoppage");
  const eligA2 = await cm1.query(api.eligibility, { boxer: boxerA });
  assert.ok("data" in eligA2 && eligA2.data.suspended === false, "31-day stoppage lapsed");
  ok("30-day suspension lapses on its own");
  const p5 = await sent(cm1, api.proposeBout, { boxerA, boxerB, boutAt: now + 35 * DAY, venue: "New Hall" }, "propose bout5");
  await sent(cm2, api.confirmBout, { bout: p5.result.id }, "confirm bout5");

  // H. Unauthenticated calls are refused.
  const anon = createClient({ url: host.url });
  await denied(anon, api.myRole, {}, "E_AUTH", "anonymous query");
  await fails(anon, api.proposeBout, { boxerA, boxerB, boutAt: now + 7 * DAY, venue: "X" }, "E_AUTH", "anonymous mutate");

  console.error(`acceptance passed: ${passed} checks`);
} finally { await cleanup(() => host.stop()); }
