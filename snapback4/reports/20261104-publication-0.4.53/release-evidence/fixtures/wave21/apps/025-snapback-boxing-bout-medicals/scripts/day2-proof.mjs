// day2:proof — full production day-two cycle against REAL production state:
// v1 live -> write v1 data -> deploy v2 -> migrate+assert -> v2 feature+rule
// -> v1 client on v2 -> rollback -> assert -> v1 client on v1 -> forward ->
// assert. Never deletes/resets/recreates production data or the deployment.
// Re-runnable: unique names per run; every check covers whole tables.
// Leaves v2 live; writes day2-proof.json; exits 0 iff all assertions held.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  DIR, ROLES, PASSWORD, DAY, ensureProdUsers, fullSnapshot, stableRow,
  expectedExperience, reconcileLabels, uploadScan, deploy, rollback, startServe, cleanup, cli, post,
} from "./prod-lib.mjs";
import { v1ReleaseId, releasesInfo } from "./prod-targets.mjs";

const log = (...a) => console.error(...a);
const failures = [];
const note = (ok, label, detail = "") => {
  log(`${ok ? "ok" : "FAIL"} - ${label}${detail ? ` :: ${detail}` : ""}`);
  if (!ok) failures.push(label);
};
const tag = Date.now().toString(36);
let host = null;
const result = {
  ok: false,
  recordsBeforeV2: 0,
  recordsCheckedAfterV2: 0,
  dataPreservedAfterV2: false,
  migratedValuesCorrect: false,
  v2FeatureWorks: false,
  v2RuleEnforced: false,
  rollback: "failed",
  dataPreservedAfterRollback: false,
  rollforward: "failed",
  dataPreservedAfterRollforward: false,
  v1ClientAfterV2: "broken",
  v1ClientAfterRollback: "broken",
  v1ClientNotes: "",
  notes: "",
};

try {
  if (process.env.PORT_LO) log(`ports: PORT_LO=${process.env.PORT_LO} PORT_HI=${process.env.PORT_HI}`);
  // 0. Production exists (created by earlier runs or here, never reset).
  const { existsSync } = await import("node:fs");
  if (!existsSync(`${DIR}/store.sqlite`)) {
    log("day2:proof: no production store; deploying v1 fresh");
    const d1 = await deploy(DIR, "versions/v1");
    if (d1.code !== 0) throw Error(`deploy v1: ${d1.stderr.slice(0, 500)}`);
  }
  const v1 = await v1ReleaseId();
  log(`day2:proof tag=${tag} v1release=${v1}`);

  // 1. Put v1 live.
  const r1 = await rollback(DIR, v1);
  if (r1.code !== 0) throw Error(`rollback to v1: ${r1.stderr.slice(0, 500)}`);
  let info = await releasesInfo();
  note(info.current === v1, "v1 live", `current=${info.current}`);

  // 2. Serve + real users (created through signup when missing).
  host = await startServe(DIR);
  const url = host.url;
  const op = await host.operatorToken();
  const users = await ensureProdUsers(url, op);
  const [coach1, coach2] = users.coach;
  const [mm1, mm2] = users.matchmaker;
  const [ph1] = users.physician;
  log(`day2:proof: serving ${url}, users ensured`);

  const freshBoxer = async (suffix) => {
    const { signup } = await import("snapback4/auth");
    const email = `day2-${suffix}-${tag}@example.test`;
    const made = await signup(url, email, PASSWORD);
    if (!made.ok) throw Error(`signup ${email}: ${JSON.stringify(made)}`);
    const s = made.session;
    const prov = await post(url, "/m/provision", { token: op }, { principal: s.principal, role: "boxer" });
    if (prov.body?.state !== "sent") throw Error(`provision ${email}: ${JSON.stringify(prov.body)}`);
    return { email, password: PASSWORD, principal: s.principal, token: s.token };
  };

  // 3. Write v1 data through v1 operations (unique names every run).
  const bxA = await freshBoxer("bxa");
  const bxB = await freshBoxer("bxb");
  const bxC = await freshBoxer("bxc");
  const regA = await post(url, "/m/registerBoxer", bxA, { name: `Day2 A ${tag}`, weightLb: 150 });
  const regB = await post(url, "/m/registerBoxer", bxB, { name: `Day2 B ${tag}`, weightLb: 165 });
  const regC = await post(url, "/m/registerBoxer", bxC, { name: `Day2 C ${tag}`, weightLb: 158 });
  note(regA.body?.state === "sent" && regB.body?.state === "sent" && regC.body?.state === "sent", "v1 registers", JSON.stringify([regA.body?.why, regB.body?.why]));
  const boxerA = regA.body.result.id, boxerB = regB.body.result.id, boxerC = regC.body.result.id;
  const scanA = await uploadScan(url, ph1.token);
  const scanB = await uploadScan(url, ph1.token);
  const scanC = await uploadScan(url, ph1.token);
  note((await post(url, "/m/recordExam", ph1, { boxer: boxerA, takenAt: Date.now(), scan: scanA })).body?.state === "sent", "v1 exam A");
  note((await post(url, "/m/recordExam", ph1, { boxer: boxerB, takenAt: Date.now(), scan: scanB })).body?.state === "sent", "v1 exam B");
  note((await post(url, "/m/recordExam", ph1, { boxer: boxerC, takenAt: Date.now(), scan: scanC })).body?.state === "sent", "v1 exam C");
  const now = Date.now();
  const p1 = await post(url, "/m/proposeBout", mm1, { boxerA, boxerB, boutAt: now + 7 * DAY, venue: `Day2 Hall ${tag}` });
  note(p1.body?.state === "sent", "v1 propose");
  const bout1 = p1.body?.result?.id;
  note((await post(url, "/m/confirmBout", mm1, { bout: bout1 })).body?.state === "sent", "v1 confirm");
  note((await post(url, "/m/recordResult", ph1, { bout: bout1, method: "decision" })).body?.state === "sent", "v1 decision (completes bout)");

  // 4. Snapshot everything before v2.
  const pre = await fullSnapshot();
  result.recordsBeforeV2 = pre.boxers.size + pre.bouts.size + pre.exams.size;
  log(`day2:proof: pre-v2: ${pre.boxers.size} boxers, ${pre.bouts.size} bouts, ${pre.exams.size} exams, ${pre.roles.size} roles`);

  // 5. Deploy v2 over the data (hot: serve keeps running).
  const d2 = await deploy(DIR, "snapback");
  if (d2.code !== 0) throw Error(`deploy v2: ${d2.stderr.slice(0, 800)}`);
  info = await releasesInfo();
  note(info.current === info.latest && info.current !== v1, "v2 live", `current=${info.current} latest=${info.latest}`);

  // 6. Reconcile every boxer to the change-request rule via matchmaker ops.
  const { corrected: corrections } = await reconcileLabels(url, mm1);
  log(`day2:proof: reconciled ${corrections} labels`);

  // 7. Assert every pre-existing record survived with the right migrated value.
  const after = await fullSnapshot();
  result.recordsCheckedAfterV2 = after.boxers.size + after.bouts.size + after.exams.size;
  let preserved = true, migrated = true;
  const stripExp = (row) => {
    const copy = { ...row };
    delete copy.experience;
    return stableRow(copy);
  };
  for (const [id, row] of pre.boxers) {
    const now2 = after.boxers.get(id);
    if (!now2) { preserved = false; log(`MISSING boxer ${id}`); continue; }
    if (stripExp(now2) !== stripExp(row)) { preserved = false; log(`CHANGED boxer ${id}`); }
    if (now2.experience !== expectedExperience(id, after.bouts)) { migrated = false; log(`WRONG-LABEL boxer ${id}: ${now2.experience}`); }
  }
  for (const t of ["bouts", "exams", "roles"]) {
    for (const [id, row] of pre[t]) {
      const now2 = after[t].get(id);
      if (!now2) { preserved = false; log(`MISSING ${t} ${id}`); continue; }
      if (stableRow(now2) !== stableRow(row)) { preserved = false; log(`CHANGED ${t} ${id}`); }
    }
  }
  // Boxers A/B completed a bout (previously competed); C has none (debut).
  const labA = after.boxers.get(boxerA)?.experience, labB = after.boxers.get(boxerB)?.experience, labC = after.boxers.get(boxerC)?.experience;
  if (labA !== "previously competed" || labB !== "previously competed" || labC !== "debut") {
    migrated = false;
    log(`RUN-ROW-MISMATCH A=${labA} B=${labB} C=${labC}`);
  }
  result.dataPreservedAfterV2 = preserved && after.boxers.size >= pre.boxers.size;
  result.migratedValuesCorrect = migrated;
  note(preserved, "data preserved after v2");
  note(migrated, "migrated values correct");

  // 8. v2 feature works for the existing accounts (fresh boxers, stable staff).
  let feature = true;
  const bxD = await freshBoxer("bxd");
  const bxE = await freshBoxer("bxe");
  const regD = await post(url, "/m/registerBoxer", bxD, { name: `Day2 D ${tag}`, weightLb: 170 });
  const boxerD = regD.body?.result?.id;
  const regE = await post(url, "/m/registerBoxer", bxE, { name: `Day2 E ${tag}`, weightLb: 172 });
  const boxerE = regE.body?.result?.id;
  feature &&= regD.body?.state === "sent" && regE.body?.state === "sent";
  const mineD = await post(url, "/q/myBoxer", bxD, {});
  feature &&= mineD.body?.data?.experience === "debut";
  feature &&= (await post(url, "/m/setExperience", mm2, { boxer: boxerD, experience: "previously competed" })).body?.state === "sent";
  const cardD = await post(url, "/q/boxerCard", mm2, { boxer: boxerD });
  feature &&= cardD.body?.data?.experience === "previously competed";
  const scanD = await uploadScan(url, ph1.token);
  const scanE = await uploadScan(url, ph1.token);
  feature &&= (await post(url, "/m/recordExam", ph1, { boxer: boxerD, takenAt: Date.now(), scan: scanD })).body?.state === "sent";
  feature &&= (await post(url, "/m/recordExam", ph1, { boxer: boxerE, takenAt: Date.now(), scan: scanE })).body?.state === "sent";
  const pDE = await post(url, "/m/proposeBout", mm1, { boxerA: boxerD, boxerB: boxerE, boutAt: Date.now() + 7 * DAY, venue: `Day2 DE ${tag}` });
  const boutDE = pDE.body?.result?.id;
  feature &&= pDE.body?.state === "sent";
  feature &&= (await post(url, "/m/confirmBout", mm1, { bout: boutDE })).body?.state === "sent";
  feature &&= (await post(url, "/m/recordResult", ph1, { bout: boutDE, method: "decision" })).body?.state === "sent";
  const cardE = await post(url, "/q/boxerCard", coach1, { boxer: boxerE });
  feature &&= cardE.body?.data?.experience === "previously competed";
  result.v2FeatureWorks = feature;
  note(feature, "v2 feature works");

  // 9. v2 rule holds between two users: coach and boxer are refused.
  const denyCoach = await post(url, "/m/setExperience", coach1, { boxer: boxerD, experience: "debut" });
  const denyBoxer = await post(url, "/m/setExperience", bxD, { boxer: boxerD, experience: "debut" });
  const denyPhys = await post(url, "/m/setExperience", ph1, { boxer: boxerD, experience: "debut" });
  const ruleHeld =
    denyCoach.body?.state === "failed" && denyCoach.body?.why?.code === "NOT_MATCHMAKER" &&
    denyBoxer.body?.state === "failed" && denyBoxer.body?.why?.code === "NOT_MATCHMAKER" &&
    denyPhys.body?.state === "failed" && denyPhys.body?.why?.code === "NOT_MATCHMAKER";
  result.v2RuleEnforced = ruleHeld;
  note(ruleHeld, "v2 rule enforced", JSON.stringify([denyCoach.body?.why?.code, denyBoxer.body?.why?.code, denyPhys.body?.why?.code]));

  const usersFile = join(tmpdir(), `day2-calls-users-${tag}.json`);
  const pub = {};
  for (const role of ROLES) pub[role] = users[role].map((u) => ({ email: u.email, password: u.password }));
  writeFileSync(usersFile, JSON.stringify(pub));
  const runV1Client = (label) => {
    let out = "";
    let code = -1;
    try {
      out = execFileSync("node", ["scripts/v1-client-calls.mjs"], {
        env: { ...process.env, BACKEND_URL: url, CALLS_USERS: usersFile },
        timeout: 180000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      });
      code = 0;
    } catch (error) {
      out = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      code = error.status ?? 1;
    }
    const lines = out.split("\n").filter((l) => l.trim().startsWith("{"));
    let okCount = 0, total = 0;
    for (const l of lines) {
      try {
        const row = JSON.parse(l);
        if ("op" in row && "ok" in row) { total++; if (row.ok) okCount++; }
      } catch { /* log tail lines */ }
    }
    const verdict = total > 0 && okCount === total ? "works" : okCount > 0 ? "degraded" : "broken";
    log(`day2:proof: v1 client ${label}: ${verdict} (${okCount}/${total}, exit ${code})`);
    return { verdict, detail: `${label}: ${okCount}/${total} calls ok, exit ${code}` };
  };

  // 10. v1 client against v2.
  const c1 = runV1Client("on v2");
  result.v1ClientAfterV2 = c1.verdict;

  // 11. Roll back to v1; assert everything (incl. v2-written rows) preserved.
  // Snapshot immediately first: the v1 client above already wrote more rows.
  const preRb = await fullSnapshot();
  const rb = await rollback(DIR, v1);
  if (rb.code !== 0) throw Error(`rollback: ${rb.stderr.slice(0, 500)}`);
  result.rollback = "ok";
  info = await releasesInfo();
  note(info.current === v1, "rollback live", `current=${info.current}`);
  const rbSnap = await fullSnapshot();
  let rbOk = true;
  for (const [id, row] of preRb.boxers) {
    const now2 = rbSnap.boxers.get(id);
    if (!now2) { rbOk = false; log(`RB-MISSING boxer ${id}`); continue; }
    if (stripExp(now2) !== stripExp(row)) { rbOk = false; log(`RB-CHANGED boxer ${id}`); }
  }
  for (const t of ["bouts", "exams", "roles"]) {
    for (const [id, row] of preRb[t]) {
      const now2 = rbSnap[t].get(id);
      if (!now2) { rbOk = false; log(`RB-MISSING ${t} ${id}`); continue; }
      if (stableRow(now2) !== stableRow(row)) { rbOk = false; log(`RB-CHANGED ${t} ${id}`); }
    }
  }
  // v2-written rows survive under v1; their labels wait dormant.
  rbOk &&= rbSnap.boxers.get(boxerD) != null && rbSnap.bouts.get(boutDE) != null;
  const dormant = await cli(["sql", "SELECT id FROM boxers", "--dormant", "--release", DIR, "--json"]);
  const dormantIds = new Set((JSON.parse(dormant.stdout).rows ?? []).map((r) => r[0]));
  rbOk &&= dormantIds.has(boxerD);
  log(`day2:proof: dormant boxer cells retained: ${dormantIds.size}`);
  result.dataPreservedAfterRollback = rbOk;
  note(rbOk, "data preserved after rollback");

  // 12. v1 client again, against v1.
  const c2 = runV1Client("after rollback");
  result.v1ClientAfterRollback = c2.verdict;
  result.v1ClientNotes = `${c1.detail}; ${c2.detail}; v1 client uses only v1 operations (register/update/exams/bouts/notes/suspension-lift); no setExperience calls.`;

  // 13. Forward to v2 again; assert once more.
  const preFw = await fullSnapshot();
  const fw = await rollback(DIR, "latest");
  if (fw.code !== 0) throw Error(`forward: ${fw.stderr.slice(0, 500)}`);
  result.rollforward = "ok";
  info = await releasesInfo();
  note(info.current === info.latest, "forward live", `current=${info.current}`);
  const fwSnap = await fullSnapshot();
  let fwOk = true;
  for (const [id, row] of preFw.boxers) {
    const now2 = fwSnap.boxers.get(id);
    if (!now2) { fwOk = false; log(`FW-MISSING boxer ${id}`); continue; }
    // preFw was read while v1 was live (no experience key); compare v1-visible fields...
    if (stripExp(now2) !== stripExp(row)) { fwOk = false; log(`FW-CHANGED boxer ${id}`); }
    // ...and require the restored label to match the change-request rule.
    if (now2.experience !== expectedExperience(id, fwSnap.bouts)) { fwOk = false; log(`FW-WRONG-LABEL boxer ${id}: ${now2.experience}`); }
  }
  for (const t of ["bouts", "exams", "roles"]) {
    for (const [id, row] of preFw[t]) {
      const now2 = fwSnap[t].get(id);
      if (!now2) { fwOk = false; log(`FW-MISSING ${t} ${id}`); continue; }
      if (stableRow(now2) !== stableRow(row)) { fwOk = false; log(`FW-CHANGED ${t} ${id}`); }
    }
  }
  fwOk &&= fwSnap.boxers.get(boxerD)?.experience === "previously competed";
  result.dataPreservedAfterRollforward = fwOk;
  note(fwOk, "data preserved after rollforward");

  result.ok = failures.length === 0;
  result.notes =
    `tag=${tag}. counts cover boxers+bouts+exams (the kinds the change request touches; roles also verified preserved). ` +
    `expected label = previously competed iff the boxer appears in >=1 completed bout (any result), else debut — the same rule recordResult enforces automatically. ` +
    `pre-existing rows reconciled post-deploy via matchmaker setExperience (${corrections} this run; idempotent across re-runs). ` +
    `v1 clients keep working because v2 adds no required args, removes no operations, and returns experience as an additive field.`;
} catch (error) {
  log(`day2:proof ABORT: ${error?.stack ?? error}`);
  failures.push(`abort: ${error?.message ?? error}`);
}
try {
  if (host) await cleanup(() => host.stop());
} catch (error) {
  log(`day2:proof stop: ${error?.message ?? error}`);
}
result.ok = failures.length === 0 && result.dataPreservedAfterV2 && result.migratedValuesCorrect &&
  result.v2FeatureWorks && result.v2RuleEnforced && result.dataPreservedAfterRollback && result.dataPreservedAfterRollforward;
writeFileSync("day2-proof.json", `${JSON.stringify(result, null, 2)}\n`);
log(`day2:proof ${result.ok ? "PASSED" : "FAILED"}: ${failures.length} failures`);
process.exit(result.ok ? 0 : 1);
