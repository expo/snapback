// client:calls — replays every backend call the frontend makes, signing each
// user in itself from CALLS_USERS sign-in details. Needs only BACKEND_URL and
// CALLS_USERS. Prints one JSON line per call to stdout, exits 0 iff all
// succeeded. A failed call never stops the replay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { login } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { api } from "../snapback/generated/api.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = 24 * 60 * 60 * 1000;
const TAG = Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
const log = (...args) => console.error("[client:calls]", ...args);

const QUERIES = new Set(["myRole", "board", "myGowns", "gownDetail", "fittingsOf", "tasksOf", "brideList", "directoryEntry"]);

async function main() {
  const url = process.env.BACKEND_URL;
  const usersPath = process.env.CALLS_USERS;
  assert.ok(url, "BACKEND_URL is required");
  assert.ok(usersPath, "CALLS_USERS is required");
  const users = JSON.parse(readFileSync(usersPath, "utf8"));

  const clients = {};
  for (const [role, accounts] of Object.entries(users)) {
    clients[role] = [];
    for (const account of accounts) {
      assert.ok(account.email && account.password, `${role} account needs email+password`);
      const signed = await login(url, account.email, account.password);
      if (!signed.ok) {
        report("login", role, false, signed.why?.message ?? "login refused");
        clients[role].push(null);
        continue;
      }
      clients[role].push(createClient({ url, session: signed.session }));
    }
  }

  const results = [];
  const report = (op, role, ok, error) => {
    results.push({ op, role, ok });
    process.stdout.write(JSON.stringify({ op, role, ok, ...(ok ? {} : { error: String(error ?? "failed") }) }) + "\n");
  };
  const call = async (op, role, client, args) => {
    try {
      if (QUERIES.has(op)) {
        const read = await client.query(api[op], args);
        if ("denied" in read) return report(op, role, false, read.denied.code);
        return report(op, role, true);
      }
      const write = await client.mutate(api[op], args);
      if (write.state !== "sent") return report(op, role, false, write.why?.code ?? write.state);
      return report(op, role, true);
    } catch (error) {
      return report(op, role, false, error?.message ?? error);
    }
  };
  const need = (value, op, role) => {
    if (!value) report(op, role, false, "skipped: creating call failed");
    return value;
  };

  const [O1, O2] = clients.owner ?? [];
  const [F1, F2] = clients.frontdesk ?? [];
  const [S1, S2] = clients.seamstress ?? [];
  const [B1, B2] = clients.bride ?? [];
  if (!O1 || !F1 || !S1 || !B1 || !O2 || !F2 || !S2 || !B2) {
    log("missing signed-in users for a role; continuing with what signed in");
  }

  const photo = async (client) => {
    const up = await client.upload(PNG);
    if (!up.ok) throw new Error(`upload refused: ${up.why?.message}`);
    return { id: up.asset.id };
  };
  const now = Date.now();

  // Brides register (upsert: safe to replay).
  if (B1) await call("registerBride", "bride", B1, { displayName: `Call Ava ${TAG}` });
  if (B2) await call("registerBride", "bride", B2, { displayName: `Call Mia ${TAG}` });

  let gown1 = null;
  let gown2 = null;
  // Owner files a gown for bride 1.
  if (O1 && B1) {
    try {
      const list = await O1.query(api.brideList, {});
      if (!("data" in list)) report("brideList", "owner", false, list.denied?.code);
      else {
        report("brideList", "owner", true);
        const write = await O1.mutate(api.logGown, {
          bride: B1.viewer(), style: `Call-Gown-${TAG}-1`, measurements: "bust 34 waist 26 hips 36",
          phone: "555-0111", address: "11 Chapel Ln", quotedPrice: 139900,
          photos: [await photo(O1)], weddingDate: now + 60 * DAY, finalFittingAt: now + 40 * DAY,
        });
        if (write.state !== "sent") report("logGown", "owner", false, write.why?.code);
        else { report("logGown", "owner", true); gown1 = write.result; }
      }
    } catch (error) { report("logGown", "owner", false, error?.message ?? error); }
  }
  // Front desk files a gown for bride 2.
  if (F1 && B2) {
    try {
      const write = await F1.mutate(api.logGown, {
        bride: B2.viewer(), style: `Call-Gown-${TAG}-2`, measurements: "bust 36 waist 28 hips 38",
        phone: "555-0112", address: "12 Chapel Ln", quotedPrice: 149900,
        photos: [await photo(F1)], weddingDate: now + 30 * DAY, finalFittingAt: now + 25 * DAY,
      });
      if (write.state !== "sent") report("logGown", "frontdesk", false, write.why?.code);
      else { report("logGown", "frontdesk", true); gown2 = write.result; }
    } catch (error) { report("logGown", "frontdesk", false, error?.message ?? error); }
  }

  // Reads the UI makes.
  if (O1) {
    await call("myRole", "owner", O1, {});
    await call("board", "owner", O1, {});
    if (need(gown1, "gownDetail", "owner")) await call("gownDetail", "owner", O1, { gown: gown1.id });
    if (need(gown1, "fittingsOf", "owner")) await call("fittingsOf", "owner", O1, { gown: gown1.id });
    if (need(gown1, "tasksOf", "owner")) await call("tasksOf", "owner", O1, { gown: gown1.id });
    if (B1) await call("directoryEntry", "owner", O1, { who: B1.viewer() });
  }
  if (O2) { await call("myRole", "owner", O2, {}); await call("board", "owner", O2, {}); }
  if (F1) {
    await call("myRole", "frontdesk", F1, {});
    await call("board", "frontdesk", F1, {});
    await call("brideList", "frontdesk", F1, {});
    if (need(gown2, "gownDetail", "frontdesk")) await call("gownDetail", "frontdesk", F1, { gown: gown2.id });
    if (need(gown2, "fittingsOf", "frontdesk")) await call("fittingsOf", "frontdesk", F1, { gown: gown2.id });
    if (need(gown2, "tasksOf", "frontdesk")) await call("tasksOf", "frontdesk", F1, { gown: gown2.id });
  }
  if (F2) { await call("myRole", "frontdesk", F2, {}); await call("board", "frontdesk", F2, {}); }
  if (S1) {
    await call("myRole", "seamstress", S1, {});
    await call("board", "seamstress", S1, {});
    if (need(gown1, "gownDetail", "seamstress")) await call("gownDetail", "seamstress", S1, { gown: gown1.id });
    if (need(gown1, "fittingsOf", "seamstress")) await call("fittingsOf", "seamstress", S1, { gown: gown1.id });
    if (need(gown1, "tasksOf", "seamstress")) await call("tasksOf", "seamstress", S1, { gown: gown1.id });
    if (B1) await call("directoryEntry", "seamstress", S1, { who: B1.viewer() });
  }
  if (S2) { await call("myRole", "seamstress", S2, {}); await call("board", "seamstress", S2, {}); }

  // Staff writes the UI makes (each as an allowed role).
  let task1 = null;
  if (O1 && need(gown1, "updateGownDetails", "owner")) {
    try {
      const detail = await O1.query(api.gownDetail, { gown: gown1.id });
      const g = detail.data;
      const write = await O1.mutate(api.updateGownDetails, {
        gown: gown1.id, style: g.style, measurements: `${g.measurements} + veil`,
        phone: g.phone ?? "555-0111", address: g.address ?? "11 Chapel Ln",
        quotedPrice: g.quotedPrice ?? 139900, weddingDate: g.weddingDate, finalFittingAt: g.finalFittingAt,
      });
      report("updateGownDetails", "owner", write.state === "sent", write.why?.code);
    } catch (error) { report("updateGownDetails", "owner", false, error?.message ?? error); }
  }
  if (F1 && need(gown2, "moveStage", "frontdesk")) await call("moveStage", "frontdesk", F1, { gown: gown2.id, stage: "fitting1" });
  if (S1 && need(gown1, "moveStage", "seamstress")) await call("moveStage", "seamstress", S1, { gown: gown1.id, stage: "fitting2" });
  if (O1 && need(gown1, "addFitting", "owner")) await call("addFitting", "owner", O1, { gown: gown1.id, note: `Owner note ${TAG}` });
  if (F1 && need(gown2, "addFitting", "frontdesk")) await call("addFitting", "frontdesk", F1, { gown: gown2.id, note: `Desk note ${TAG}` });
  if (S1 && need(gown1, "addFitting", "seamstress")) await call("addFitting", "seamstress", S1, { gown: gown1.id, note: `Seam note ${TAG}` });
  if (O1 && need(gown1, "addTask", "owner")) {
    try {
      const write = await O1.mutate(api.addTask, { gown: gown1.id, title: `Steam veil ${TAG}` });
      if (write.state !== "sent") report("addTask", "owner", false, write.why?.code);
      else { report("addTask", "owner", true); task1 = write.result; }
    } catch (error) { report("addTask", "owner", false, error?.message ?? error); }
  }
  if (F1 && need(gown2, "addTask", "frontdesk")) await call("addTask", "frontdesk", F1, { gown: gown2.id, title: `Press train ${TAG}` });
  if (S1 && need(task1, "setTaskDone", "seamstress")) await call("setTaskDone", "seamstress", S1, { task: task1.id, done: true });
  if (O1 && need(gown2, "approveRush", "owner")) await call("approveRush", "owner", O1, { gown: gown2.id, approved: true });
  if (O1 && need(gown2, "approveRedo", "owner")) await call("approveRedo", "owner", O1, { gown: gown2.id, approved: true });

  // Bride reads of her own gown and history.
  for (const [client, gown] of [[B1, gown1], [B2, gown2]]) {
    if (!client) continue;
    await call("myRole", "bride", client, {});
    await call("directoryEntry", "bride", client, { who: client.viewer() });
    await call("myGowns", "bride", client, {});
    if (need(gown, "gownDetail", "bride")) await call("gownDetail", "bride", client, { gown: gown.id });
    if (need(gown, "fittingsOf", "bride")) await call("fittingsOf", "bride", client, { gown: gown.id });
    if (need(gown, "tasksOf", "bride")) await call("tasksOf", "bride", client, { gown: gown.id });
  }

  const failed = results.filter((r) => !r.ok);
  log(`${results.length - failed.length}/${results.length} calls ok`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("[client:calls] INFRA FAILED:", error?.message ?? error);
  process.exit(1);
});