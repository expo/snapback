// day2:proof — end-to-end production cycle, rerunnable, additive only.
//
// 1. Starts from whatever production holds (./deploy); never deletes, resets
//    or recreates production data or the deployment.
// 2. Puts v1 live, signs in real users (creating them if needed) and writes
//    v1 data through the v1 operations.
// 3. Deploys v2 and asserts every pre-existing record survived with the right
//    migrated values (note -> observation word for word, instructions empty
//    for newly migrated rows), that the v2 feature works and the v2 rule holds.
// 4. Replays the frozen v1 client against v2 (recorded, not asserted).
// 5. Rolls back to v1, asserts preservation, replays the v1 client (recorded).
// 6. Moves forward to v2, asserts preservation, stops everything, leaves v2
//    live, writes day2-proof.json and exits 0 iff every assertion held.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cli, deploy, rollback, startServe, cleanup } from "snapback4/proof";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";
import { api as v1api } from "../v1/api.ts";
import { ensureProdUsers, PROD_PASSWORD } from "./prod-users.mjs";
import { login } from "snapback4/auth";

const DIR = "./deploy";
const TAG = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const DAY = 24 * 60 * 60 * 1000;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const log = (...args) => console.error("[day2:proof]", ...args);

const failures = [];
function check(cond, label) {
  log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) failures.push(label);
  return cond;
}

async function checkedCli(args, label) {
  const r = await cli(args);
  if (r.code !== 0) {
    check(false, `${label}: exit ${r.code} ${r.stderr.slice(-400)}`);
    throw new Error(`${label} failed`);
  }
  return r.stdout;
}

async function sql(sqlText) {
  const out = await checkedCli(["sql", sqlText, "--release", DIR, "--json", "--limit", "100000"], "sql");
  const parsed = JSON.parse(out);
  if (parsed.more) throw new Error("snapshot truncated; production grew past the read limit");
  return parsed;
}

async function countOf(table) {
  return (await sql(`SELECT COUNT(*) FROM ${table}`)).rows[0][0];
}

// Full snapshot of every application table as id-keyed row objects.
async function snapshotTables() {
  const snap = {};
  for (const table of ["roles", "brideDirectory", "gowns", "fittings", "tasks"]) {
    const n = await countOf(table);
    if (n === 0) { snap[table] = new Map(); continue; }
    const out = await sql(`SELECT * FROM ${table}`);
    const map = new Map();
    for (const row of out.rows) {
      const obj = Object.fromEntries(out.columns.map((c, i) => [c, row[i]]));
      map.set(obj.id, obj);
    }
    snap[table] = map;
  }
  return snap;
}

const fittingText = (row) => row.observation ?? row.note;

function replayV1Client(url, users) {
  const usersFile = join(tmpdir(), `day2-calls-users-${TAG}.json`);
  const minimal = Object.fromEntries(
    Object.entries(users).map(([role, accounts]) => [role, accounts.map((a) => ({ email: a.email, password: a.password }))]),
  );
  writeFileSync(usersFile, JSON.stringify(minimal));
  const r = spawnSync(process.execPath, ["scripts/v1-client-calls.mjs"], {
    env: { ...process.env, BACKEND_URL: url, CALLS_USERS: usersFile },
    encoding: "utf8",
  });
  const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
  let ok = 0, total = 0;
  const bad = [];
  for (const line of lines) {
    try {
      const p = JSON.parse(line);
      total += 1;
      if (p.ok) ok += 1;
      else bad.push(`${p.op}/${p.role}:${p.error ?? "failed"}`);
    } catch { /* ignore non-JSON stdout */ }
  }
  return { ok, total, bad, exit: r.status };
}

function clientStatus({ ok, total }) {
  if (total === 0) return "broken";
  if (ok === total) return "works";
  if (ok === 0) return "broken";
  return "degraded";
}

async function main() {
  if (!existsSync(join(DIR, "store.sqlite"))) {
    log("no production store; deploying v1 fresh");
    const first = await deploy(DIR, "v1/schema.q");
    check(first.code === 0, `fresh v1 deploy (code ${first.code})`);
  }
  const host = await startServe(DIR);
  const report = {
    ok: false,
    recordsBeforeV2: 0, recordsCheckedAfterV2: 0,
    dataPreservedAfterV2: false, migratedValuesCorrect: false,
    v2FeatureWorks: false, v2RuleEnforced: false,
    rollback: "failed", dataPreservedAfterRollback: false,
    rollforward: "failed", dataPreservedAfterRollforward: false,
    v1ClientAfterV2: "broken", v1ClientAfterRollback: "broken",
    v1ClientNotes: "", notes: "",
  };
  const notes = [];
  try {
    const url = host.url;
    log("production", url);
    const users = await ensureProdUsers(url, await host.operatorToken());
    const clientFor = (who) => createClient({ url, session: who.session });
    const [O1, O2] = users.owner.map(clientFor);
    const [F1, F2] = users.frontdesk.map(clientFor);
    const [S1, S2] = users.seamstress.map(clientFor);
    const [B1, B2] = users.bride.map(clientFor);
    const bridePrincipal = (c, i) => users.bride[i].principal;

    // --- v1 live, v1 writes through the v1 operations (old spelling) ---
    const back = await rollback(DIR, 1);
    check(back.code === 0, "v1 live");

    const photo = async (client) => {
      const up = await client.upload(PNG);
      assert.equal(up.ok, true, "photo upload");
      return { id: up.asset.id };
    };
    const v1mut = async (client, op, args, label) => {
      const w = await client.mutate(op, args);
      assert.equal(w.state, "sent", `${label}: ${w.state} ${JSON.stringify(w.why ?? null)}`);
      return w.result;
    };
    const now = Date.now();
    const gownA = await v1mut(O1, v1api.logGown, {
      bride: bridePrincipal(B1, 0), style: `Day2 Gown A ${TAG}`, measurements: "bust 34 waist 26 hips 36",
      phone: "555-0201", address: "21 Chapel Ln", quotedPrice: 139900,
      photos: [await photo(O1)], weddingDate: now + 60 * DAY, finalFittingAt: now + 40 * DAY,
    }, "v1 logGown A");
    const gownB = await v1mut(F1, v1api.logGown, {
      bride: bridePrincipal(B2, 1), style: `Day2 Gown B ${TAG}`, measurements: "bust 36 waist 28 hips 38",
      phone: "555-0202", address: "22 Chapel Ln", quotedPrice: 149900,
      photos: [await photo(F1)], weddingDate: now + 30 * DAY, finalFittingAt: now + 25 * DAY,
    }, "v1 logGown B");
    const fitA = await v1mut(S1, v1api.addFitting, { gown: gownA.id, note: `Day2 note A ${TAG}` }, "v1 addFitting A");
    const fitB = await v1mut(F2, v1api.addFitting, { gown: gownB.id, note: `Day2 note B ${TAG}` }, "v1 addFitting B");
    const newFittingIds = new Set([fitA.id, fitB.id]);
    const taskA = await v1mut(F1, v1api.addTask, { gown: gownA.id, title: `Press ${TAG}` }, "v1 addTask");
    await v1mut(S1, v1api.setTaskDone, { task: taskA.id, done: true }, "v1 setTaskDone");
    await v1mut(S1, v1api.moveStage, { gown: gownA.id, stage: "fitting1" }, "v1 moveStage");
    await v1mut(O1, v1api.approveRush, { gown: gownB.id, approved: true }, "v1 approveRush");
    log("v1 writes done");

    const before = await snapshotTables();
    report.recordsBeforeV2 = before.fittings.size;

    // --- deploy v2 over the data ---
    const dep = await deploy(DIR, "snapback");
    check(dep.code === 0, "v2 deploy");

    const after = await snapshotTables();
    report.recordsCheckedAfterV2 = after.fittings.size;
    let preserved = true, migrated = true;
    for (const [table, rows] of Object.entries(before)) {
      for (const id of rows.keys()) {
        if (!after[table].has(id)) { preserved = false; log(`LOST ${table}:${id}`); }
      }
    }
    for (const [id, row] of before.fittings) {
      const nowRow = after.fittings.get(id);
      if (!nowRow) { migrated = false; continue; }
      if (nowRow.observation !== row.note) {
        migrated = false;
        log(`MIGRATION MISMATCH ${id}: ${JSON.stringify(row.note)} -> ${JSON.stringify(nowRow.observation)}`);
      }
      if (newFittingIds.has(id) && nowRow.instructions !== "") {
        migrated = false;
        log(`INSTRUCTIONS NOT EMPTY ${id}: ${JSON.stringify(nowRow.instructions)}`);
      }
    }
    report.dataPreservedAfterV2 = check(preserved, `all ${Object.values(before).reduce((n, m) => n + m.size, 0)} pre-existing records survive v2`);
    report.migratedValuesCorrect = check(migrated, "notes carried word for word; new rows' instructions empty");

    // --- v2 feature works for the existing accounts ---
    const seamSet = await S1.mutate(api.setInstructions, { fitting: fitA.id, instructions: `Take in ${TAG}` });
    const ownSet = await O1.mutate(api.setInstructions, { fitting: fitB.id, instructions: `Hem ${TAG}` });
    let feature = seamSet.state === "sent" && ownSet.state === "sent";
    const reread = await S2.query(api.fittingsOf, { gown: gownA.id });
    if ("data" in reread) {
      const row = reread.data.find((f) => f.id === fitA.id);
      feature = feature && !!row && row.instructions === `Take in ${TAG}` && row.observation === `Day2 note A ${TAG}`;
    } else feature = false;
    report.v2FeatureWorks = check(feature, "seamstress+owner set instructions; observation preserved");

    // --- v2 rule holds between two users ---
    // Fresh logins: long-lived clients created before a release move can trip
    // the client-side liveness gate, so re-authenticate right here to isolate
    // the rule from client staleness.
    const freshClient = async (email) => {
      const s = await login(url, email, PROD_PASSWORD);
      assert.equal(s.ok, true, `fresh login ${email}`);
      return createClient({ url, session: s.session });
    };
    const F1fresh = await freshClient(users.frontdesk[0].email);
    const B1fresh = await freshClient(users.bride[0].email);
    const deskTry = await F1fresh.mutate(api.setInstructions, { fitting: fitA.id, instructions: "sneaky" });
    const brideTry = await B1fresh.mutate(api.setInstructions, { fitting: fitA.id, instructions: "sneaky" });
    log(`rule probe desk: ${deskTry.state} ${deskTry.why?.code} / bride: ${brideTry.state} ${brideTry.why?.code}`);
    const ruleHolds =
      deskTry.state === "failed" && deskTry.why?.code === "NOT_INSTRUCTIONS" &&
      brideTry.state === "failed" && brideTry.why?.code === "NOT_INSTRUCTIONS";
    report.v2RuleEnforced = check(ruleHolds, "frontdesk and bride refused NOT_INSTRUCTIONS");
    const expectedFittings = new Map(
      [...after.fittings].map(([id, row]) => [id, { ...row }]),
    );
    expectedFittings.get(fitA.id).instructions = `Take in ${TAG}`;
    expectedFittings.get(fitB.id).instructions = `Hem ${TAG}`;
    const expected = { ...after, fittings: expectedFittings };

    // --- v1 client against v2 (recorded, not asserted) ---
    const onV2 = replayV1Client(url, users);
    report.v1ClientAfterV2 = clientStatus(onV2);
    notes.push(`v1 client on v2: ${onV2.ok}/${onV2.total} ok${onV2.bad.length ? `; failed: ${onV2.bad.join("; ").slice(0, 500)}` : ""}`);

    // --- rollback to v1, preservation incl. what v2 wrote ---
    const rb = await rollback(DIR, 1);
    report.rollback = rb.code === 0 ? "ok" : "failed";
    check(rb.code === 0, "rollback to v1");
    const rolled = await snapshotTables();
    let rollOk = true;
    for (const [table, rows] of Object.entries(expected)) {
      for (const id of rows.keys()) {
        if (!rolled[table].has(id)) { rollOk = false; log(`LOST AFTER ROLLBACK ${table}:${id}`); }
      }
    }
    for (const [id, row] of expected.fittings) {
      const backRow = rolled.fittings.get(id);
      if (!backRow || backRow.note !== row.observation) {
        rollOk = false;
        log(`ROLLBACK MISMATCH ${id}: ${JSON.stringify(row.observation)} -> ${JSON.stringify(backRow?.note)}`);
      }
    }
    report.dataPreservedAfterRollback = check(rollOk, "all records (incl. v2 writes) preserved through rollback");

    const onV1 = replayV1Client(url, users);
    report.v1ClientAfterRollback = clientStatus(onV1);
    notes.push(`v1 client on v1 after rollback: ${onV1.ok}/${onV1.total} ok${onV1.bad.length ? `; failed: ${onV1.bad.join("; ").slice(0, 500)}` : ""}`);

    // --- forward to v2 again ---
    const fw = await rollback(DIR, "latest");
    report.rollforward = fw.code === 0 ? "ok" : "failed";
    check(fw.code === 0, "forward to v2");
    const fwd = await snapshotTables();
    let fwdOk = true;
    for (const [table, rows] of Object.entries(expected)) {
      for (const id of rows.keys()) {
        if (!fwd[table].has(id)) { fwdOk = false; log(`LOST AFTER FORWARD ${table}:${id}`); }
      }
    }
    for (const [id, row] of expected.fittings) {
      const fRow = fwd.fittings.get(id);
      if (!fRow || fRow.observation !== row.observation || fRow.instructions !== row.instructions) {
        fwdOk = false;
        log(`FORWARD MISMATCH ${id}`);
      }
    }
    report.dataPreservedAfterRollforward = check(fwdOk, "all records preserved through rollforward");

    report.v1ClientNotes = notes.join(" | ");
    report.notes = `TAG ${TAG}: v1 wrote gowns Day2 Gown A/B, notes Day2 note A/B; v2 set instructions Take in/Hem ${TAG}. Checks cover every row of every table via SELECT *.`;
    report.ok = failures.length === 0;
  } finally {
    await cleanup(() => host.stop());
  }
  writeFileSync("day2-proof.json", JSON.stringify(report, null, 2) + "\n");
  log(`day2-proof ${report.ok ? "PASSED" : "FAILED"}${failures.length ? `: ${failures.join("; ")}` : ""}`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error("[day2:proof] INFRA FAILED:", error?.message ?? error);
  process.exit(1);
});
