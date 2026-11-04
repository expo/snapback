// Acceptance: drives every backend operation as the appropriate users and
// asserts every authorization and privacy rule in the spec, including each
// refusal the spec implies. Fresh disposable staging backend on every run, so
// it passes when run twice in a row.
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { deploy, startServe, cleanup } from "snapback4/proof";
import { login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = 24 * 60 * 60 * 1000;
const TAG = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const email = (role, i) => `accept-${TAG}-${role}${i}@example.test`;
const PASSWORD = "correct horse battery staple";

const log = (...args) => console.error("[acceptance]", ...args);

function isFlagged(gown) {
  return gown.finalFittingAt != null && gown.weddingDate - gown.finalFittingAt < 10 * DAY;
}

async function main() {
  rmSync("staging-accept", { recursive: true, force: true });
  const deployed = await deploy("staging-accept", "snapback", { args: ["--staging"] });
  assert.equal(deployed.code, 0, `deploy failed: ${deployed.stderr}`);
  const host = await startServe("staging-accept", {
    seedUsers: {
      roles: { owner: 2, frontdesk: 2, seamstress: 2, bride: 2 },
      provision: api.provision,
    },
  });
  try {
    const url = host.url;
    log("serving", url);
    const sessions = host.sessions;
    assert.equal(Object.keys(sessions).length, 4);
    for (const [role, accounts] of Object.entries(sessions)) assert.equal(accounts.length, 2, role);

    // Every user signs in through the real password path, with a fresh client.
    const clients = {};
    for (const [role, accounts] of Object.entries(sessions)) {
      clients[role] = [];
      for (const account of accounts) {
        const signed = await login(url, account.email, account.password);
        assert.equal(signed.ok, true, `${role} login`);
        assert.equal(signed.session.principal, account.principal);
        clients[role].push({ account, client: createClient({ url, session: signed.session }) });
      }
    }
    const [O1, O2] = clients.owner;
    const [F1, F2] = clients.frontdesk;
    const [S1, S2] = clients.seamstress;
    const [B1, B2] = clients.bride;

    // Wrong password must not sign in or change anything.
    const badLogin = await login(url, B1.account.email, "wrong password 000");
    assert.equal(badLogin.ok, false, "wrong password refuses");

    const q = async (c, op, args) => c.client.query(op, args);
    const m = async (c, op, args) => c.client.mutate(op, args);
    const qdata = async (c, op, args, label) => {
      const r = await q(c, op, args);
      assert.ok("data" in r, `${label}: expected data, got ${JSON.stringify(r).slice(0, 200)}`);
      return r.data;
    };
    const qdenied = async (c, op, args, code, label) => {
      const r = await q(c, op, args);
      assert.ok("denied" in r, `${label}: expected denial, got data`);
      assert.equal(r.denied.code, code, `${label}: code`);
    };
    const mrefused = async (c, op, args, code, label) => {
      const r = await m(c, op, args);
      assert.equal(r.state, "failed", `${label}: expected failure, got ${r.state}`);
      assert.equal(r.why.code, code, `${label}: code`);
    };
    const msent = async (c, op, args, label) => {
      const r = await m(c, op, args);
      assert.equal(r.state, "sent", `${label}: expected sent, got ${r.state} ${JSON.stringify(r.why ?? null)}`);
      return r.result;
    };

    // Roles landed where the operator put them.
    assert.equal((await qdata(O1, api.myRole, {}, "O1 role")).role, "owner");
    assert.equal((await qdata(F1, api.myRole, {}, "F1 role")).role, "frontdesk");
    assert.equal((await qdata(S1, api.myRole, {}, "S1 role")).role, "seamstress");
    assert.equal((await qdata(B1, api.myRole, {}, "B1 role")).role, "bride");

    // Only the operator can provision: a front desk grant attempt refuses.
    await mrefused(F1, api.provision, { principal: B1.account.principal, role: "bride" }, "NOT_OPERATOR", "frontdesk provision");

    // Brides join the directory; anyone without the bride role refuses.
    await msent(B1, api.registerBride, { displayName: `Bride One ${TAG}` }, "B1 register");
    await msent(B2, api.registerBride, { displayName: `Bride Two ${TAG}` }, "B2 register");
    await mrefused(S1, api.registerBride, { displayName: "Sneaky" }, "NOT_BRIDE", "seamstress register");
    await mrefused(F1, api.registerBride, { displayName: "Sneaky" }, "NOT_BRIDE", "frontdesk register");

    // Unauthenticated calls are refused before any rule runs.
    const anon = { client: createClient({ url }) };
    await qdenied(anon, api.board, {}, "E_AUTH", "anon board");
    await mrefused(anon, api.logGown, {
      bride: B1.account.principal, style: "x", measurements: "m", phone: "p",
      address: "a", quotedPrice: 100, photos: [], weddingDate: Date.now() + 60 * DAY,
    }, "E_AUTH", "anon logGown");

    const uploadPhoto = async (c, label) => {
      const up = await c.client.upload(PNG);
      assert.equal(up.ok, true, `${label}: upload`);
      return { id: up.asset.id };
    };

    const now = Date.now();
    // Gown 1: final fitting 10+ days before the wedding (not flagged).
    const gown1 = await msent(F1, api.logGown, {
      bride: B1.account.principal, style: `Gown-${TAG}-1`, measurements: "bust 34 waist 26 hips 36",
      phone: "555-0101", address: "1 Chapel Ln", quotedPrice: 129900,
      photos: [await uploadPhoto(F1, "gown1 photo")],
      weddingDate: now + 60 * DAY, finalFittingAt: now + 40 * DAY,
    }, "F1 logGown gown1");
    assert.ok(gown1?.id, "gown1 id");
    // Gown 2: final fitting 5 days before the wedding (flagged).
    const gown2 = await msent(F2, api.logGown, {
      bride: B2.account.principal, style: `Gown-${TAG}-2`, measurements: "bust 36 waist 28 hips 38",
      phone: "555-0102", address: "2 Chapel Ln", quotedPrice: 159900,
      photos: [await uploadPhoto(F2, "gown2 photo")],
      weddingDate: now + 30 * DAY, finalFittingAt: now + 25 * DAY,
    }, "F2 logGown gown2");

    // logGown refusals: unknown bride, past wedding, fitting after wedding,
    // wrong role, missing photo.
    await mrefused(F1, api.logGown, {
      bride: "prn:00000000000000000000000000", style: `Gown-${TAG}-x`, measurements: "m",
      phone: "p", address: "a", quotedPrice: 100, photos: [await uploadPhoto(F1, "x photo")],
      weddingDate: now + 60 * DAY, finalFittingAt: null,
    }, "UNKNOWN_BRIDE", "unknown bride");
    await mrefused(F1, api.logGown, {
      bride: B1.account.principal, style: `Gown-${TAG}-past`, measurements: "m", phone: "p",
      address: "a", quotedPrice: 100, photos: [await uploadPhoto(F1, "past photo")],
      weddingDate: now - DAY, finalFittingAt: null,
    }, "WEDDING_PAST", "past wedding");
    await mrefused(F1, api.logGown, {
      bride: B1.account.principal, style: `Gown-${TAG}-late`, measurements: "m", phone: "p",
      address: "a", quotedPrice: 100, photos: [await uploadPhoto(F1, "late photo")],
      weddingDate: now + 60 * DAY, finalFittingAt: now + 61 * DAY,
    }, "FITTING_AFTER_WEDDING", "fitting after wedding");
    await mrefused(S1, api.logGown, {
      bride: B1.account.principal, style: `Gown-${TAG}-s`, measurements: "m", phone: "p",
      address: "a", quotedPrice: 100, photos: [await uploadPhoto(S1, "s photo")],
      weddingDate: now + 60 * DAY, finalFittingAt: null,
    }, "NOT_STAFF", "seamstress logGown");
    await mrefused(B1, api.logGown, {
      bride: B1.account.principal, style: `Gown-${TAG}-b`, measurements: "m", phone: "p",
      address: "a", quotedPrice: 100, photos: [await uploadPhoto(B1, "b photo")],
      weddingDate: now + 60 * DAY, finalFittingAt: null,
    }, "NOT_STAFF", "bride logGown");

    // Flag rule evaluated on backend-returned dates (same formula as the UI).
    const g1 = await qdata(F1, api.gownDetail, { gown: gown1.id }, "gown1 detail");
    const g2 = await qdata(F1, api.gownDetail, { gown: gown2.id }, "gown2 detail");
    assert.equal(isFlagged(g1), false, "gown1 not flagged");
    assert.equal(isFlagged(g2), true, "gown2 flagged");

    // Board: staff see every gown, complete; brides are refused by rule.
    const boardS1 = await q(S1, api.board, {});
    assert.ok("data" in boardS1 && boardS1.complete === true, "seamstress board complete");
    assert.equal(boardS1.data.length, 2, "seamstress sees both gowns");
    await qdenied(B1, api.board, {}, "NOT_STAFF", "bride board");

    // Column privacy: seamstress reads photos/measurements/notes/work but the
    // private columns come back null; front desk sees the real values.
    for (const row of boardS1.data) {
      assert.ok(row.phone == null, "seamstress phone hidden");
      assert.ok(row.address == null, "seamstress address hidden");
      assert.ok(row.quotedPrice == null, "seamstress price hidden");
      assert.ok(row.measurements.length > 0, "seamstress sees measurements");
      assert.ok(row.photos.length === 1, "seamstress sees photos");
    }
    const boardF1 = await qdata(F1, api.board, {}, "F1 board");
    const both = new Map(boardF1.map((g) => [g.id, g]));
    assert.equal(both.get(gown1.id).phone, "555-0101", "frontdesk sees phone");
    assert.equal(both.get(gown1.id).address, "1 Chapel Ln", "frontdesk sees address");
    assert.equal(both.get(gown1.id).quotedPrice, 129900, "frontdesk sees price");
    const boardO2 = await qdata(O2, api.board, {}, "O2 board");
    assert.equal(boardO2.length, 2, "second owner sees both gowns");

    // Brides see only their own gown and its history.
    const mineB1 = await qdata(B1, api.myGowns, {}, "B1 myGowns");
    assert.equal(mineB1.length, 1, "B1 one gown");
    assert.equal(mineB1[0].id, gown1.id, "B1 own gown");
    assert.equal(mineB1[0].phone, "555-0101", "bride sees own phone");
    const mineB2 = await qdata(B2, api.myGowns, {}, "B2 myGowns");
    assert.equal(mineB2.length, 1, "B2 one gown");
    assert.equal(mineB2[0].id, gown2.id, "B2 own gown");
    const otherDetail = await q(B1, api.gownDetail, { gown: gown2.id });
    assert.ok("data" in otherDetail && otherDetail.data === null, "B1 cannot read B2 gown");
    const ownDetail = await qdata(B1, api.gownDetail, { gown: gown1.id }, "B1 own detail");
    assert.equal(ownDetail.style, gown1.style, "B1 reads own gown");

    // Stage moves show up on the board (live workroom updates).
    await msent(S1, api.moveStage, { gown: gown1.id, stage: "fitting1" }, "S1 moveStage");
    const moved = await qdata(S2, api.board, {}, "S2 board after move");
    assert.equal(moved.find((g) => g.id === gown1.id).stage, "fitting1", "board reflects move");
    await mrefused(B1, api.moveStage, { gown: gown1.id, stage: "final" }, "NOT_STAFF", "bride moveStage");
    await mrefused(S1, api.moveStage, { gown: gown2.id, stage: "nope" }, "E_INPUT", "bad stage");

    // Fitting notes and tasks: staff write, brides read their own.
    // v2: fit observations (new spelling) and the v1 `note` spelling (alias)
    // both file an observation; alteration instructions start empty.
    const fit1 = await msent(S1, api.addFitting, { gown: gown1.id, observation: "Hem pinned 2cm" }, "S1 addFitting");
    const fit2 = await msent(F2, api.addFitting, { gown: gown2.id, note: "Bodice taken in" }, "F2 addFitting note-alias");
    await mrefused(B1, api.addFitting, { gown: gown1.id, observation: "nope" }, "NOT_STAFF", "bride addFitting");
    await mrefused(S1, api.addFitting, { gown: gown1.id, observation: "both", note: "spellings" }, "E_INPUT", "both spellings refused");
    const notesB1 = await qdata(B1, api.fittingsOf, { gown: gown1.id }, "B1 own notes");
    const seen1 = notesB1.find((f) => f.id === fit1.id);
    assert.ok(seen1 && seen1.observation === "Hem pinned 2cm", "B1 sees own history");
    assert.equal(seen1.instructions, "", "instructions start empty");
    const notesOther = await q(B1, api.fittingsOf, { gown: gown2.id });
    assert.ok("data" in notesOther && notesOther.data.length === 0, "B1 sees none of B2 history");
    const notesS2 = await qdata(S2, api.fittingsOf, { gown: gown1.id }, "S2 notes");
    assert.ok(notesS2.some((f) => f.observation === "Hem pinned 2cm"), "seamstress 2 sees notes");

    // v2 rule: only seamstresses and the owner may change instructions.
    await msent(S1, api.setInstructions, { fitting: fit1.id, instructions: "Take in bodice 2cm" }, "S1 setInstructions");
    await msent(O1, api.setInstructions, { fitting: fit2.id, instructions: "Shorten hem 5cm" }, "O1 setInstructions");
    await mrefused(F2, api.setInstructions, { fitting: fit2.id, instructions: "sneaky" }, "NOT_INSTRUCTIONS", "frontdesk author setInstructions");
    await mrefused(F1, api.setInstructions, { fitting: fit1.id, instructions: "sneaky" }, "NOT_INSTRUCTIONS", "frontdesk setInstructions");
    await mrefused(B1, api.setInstructions, { fitting: fit1.id, instructions: "sneaky" }, "NOT_INSTRUCTIONS", "bride setInstructions");
    const afterB1 = await qdata(B1, api.fittingsOf, { gown: gown1.id }, "B1 notes after instructions");
    const edited1 = afterB1.find((f) => f.id === fit1.id);
    assert.equal(edited1.instructions, "Take in bodice 2cm", "bride reads instructions");
    assert.equal(edited1.observation, "Hem pinned 2cm", "observation untouched by instructions edit");
    const afterF1 = await qdata(F1, api.fittingsOf, { gown: gown2.id }, "F1 notes after instructions");
    assert.equal(afterF1.find((f) => f.id === fit2.id).instructions, "Shorten hem 5cm", "owner edit visible");

    const task = await msent(F1, api.addTask, { gown: gown1.id, title: "Press hem" }, "F1 addTask");
    await msent(S1, api.setTaskDone, { task: task.id, done: true }, "S1 task done");
    const tasksB1 = await qdata(B1, api.tasksOf, { gown: gown1.id }, "B1 own tasks");
    assert.ok(tasksB1.some((t) => t.title === "Press hem" && t.done === true), "B1 sees work done");
    await mrefused(B1, api.setTaskDone, { task: task.id, done: false }, "NOT_STAFF", "bride setTaskDone");
    await mrefused(B1, api.addTask, { gown: gown1.id, title: "nope" }, "NOT_STAFF", "bride addTask");

    // Detail edits are front desk / owner only.
    await msent(F1, api.updateGownDetails, {
      gown: gown1.id, style: gown1.style, measurements: "bust 34 waist 25 hips 36",
      phone: "555-0101", address: "1 Chapel Ln", quotedPrice: 129900,
      weddingDate: g1.weddingDate, finalFittingAt: g1.finalFittingAt,
    }, "F1 update details");
    const edited = await qdata(B1, api.gownDetail, { gown: gown1.id }, "B1 sees edit");
    assert.equal(edited.measurements, "bust 34 waist 25 hips 36", "measurements updated");
    await mrefused(S1, api.updateGownDetails, {
      gown: gown1.id, style: "x", measurements: "m", phone: "p", address: "a",
      quotedPrice: 1, weddingDate: g1.weddingDate, finalFittingAt: null,
    }, "NOT_STAFF", "seamstress update");

    // Only the owner approves a rush charge or a free redo.
    await mrefused(F1, api.approveRush, { gown: gown2.id, approved: true }, "NOT_OWNER", "frontdesk rush");
    await mrefused(S1, api.approveRedo, { gown: gown2.id, approved: true }, "NOT_OWNER", "seamstress redo");
    await mrefused(B1, api.approveRush, { gown: gown1.id, approved: true }, "NOT_OWNER", "bride rush");
    await msent(O1, api.approveRush, { gown: gown2.id, approved: true }, "O1 rush");
    await msent(O1, api.approveRedo, { gown: gown2.id, approved: true }, "O1 redo");
    const approved = await qdata(O2, api.gownDetail, { gown: gown2.id }, "O2 sees approvals");
    assert.equal(approved.rushApproved, true, "rush approved");
    assert.equal(approved.freeRedo, true, "redo approved");

    // Directory: staff picker works for front desk, not for seamstresses or brides.
    const list = await qdata(F1, api.brideList, {}, "F1 brideList");
    assert.equal(list.length, 2, "two brides listed");
    await qdenied(S1, api.brideList, {}, "NOT_STAFF", "seamstress brideList");
    await qdenied(B1, api.brideList, {}, "NOT_STAFF", "bride brideList");
    const entryS1 = await qdata(S1, api.directoryEntry, { who: B1.account.principal }, "S1 directoryEntry");
    assert.equal(entryS1.displayName, `Bride One ${TAG}`, "seamstress resolves bride name");
    const hiddenEntry = await q(B2, api.directoryEntry, { who: B1.account.principal });
    assert.ok("data" in hiddenEntry && hiddenEntry.data === null, "bride cannot resolve another bride");

    log("all acceptance assertions held");
  } finally {
    await cleanup(() => host.stop());
  }
}

main().then(() => process.exit(0), (error) => {
  console.error("[acceptance] FAILED:", error?.message ?? error);
  process.exit(1);
});