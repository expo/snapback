#!/usr/bin/env node
// @ref LLP 1013#7-the-simulator-witness — scheduled native evidence, never a push gate.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { binary, workspace, project, dist, environment, prepareExpoProject, run } from "./expo-project.mjs";
import { controlServer } from "./witness-expo/control.mjs";
import { assertNoMediaOnDisk } from "./witness-expo/container.mjs";
import { ownerHarness, seedWitness } from "./witness-expo/owner.mjs";

const names = ["build, owner seed, and outward control", "login, inbox drain, three chats and two photos", "offline and two queued sends",
  "SIGKILL at barrier; exact pre-swap state across all five stores and twin prediction", "SIGKILL at rest; same cold state",
  "persistent carrier fault reports over control", "post-commit 503, exactly-once replay and FIFO",
  "offline expiry disappears from held search", "Expo driver conformance including real failed COMMIT", "persist online, relaunch and drain"];
const steps = [];
let control, owner, device, appPid, seed, before, queued;
const bundleId = "dev.snapback.chat";
const controlPort = 43219, ownerPort = 43220;
const log = (text) => process.stdout.write(`${text}\n`);
const command = (...args) => control.command(...args);
async function killApp() {
  if (!appPid) throw new Error("no pid recorded at launch");
  const pid = appPid;
  process.kill(pid, "SIGKILL");
  control.reset();
  const deadline = Date.now() + 10_000;
  for (;;) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === "ESRCH") break; throw error; }
    if (Date.now() > deadline) throw new Error(`recorded app pid ${pid} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  appPid = undefined;
}
async function launch(waitForConnection = true) {
  const generation = control.generation;
  const launched = await run("xcrun", ["simctl", "launch", device, bundleId], { timeout: 30_000 });
  const match = launched.match(/:\s*(\d+)\s*$/m);
  if (!match) throw new Error(`simctl launch did not return a pid: ${launched}`);
  appPid = Number(match[1]);
  if (waitForConnection) await control.connected(generation);
  return launched.trim();
}
// @ref LLP 1013#7-the-simulator-witness — the reopened database is inspected before
// any client constructs: a mounted app writes (a drain's mark, adoption), so a read
// of the carrier after construction would compare activity, not the recovery.
function coldStores(cold) {
  assert.deepEqual(cold.stores, before.stores, "the post-swap state or any mixture is a failure");
  for (const name of ["rows", "answers", "outbox", "state", "bytes"]) assert.ok(cold.stores[name].length, `${name} has pre-swap markers`);
}
function coldAssertions(state) {
  assert.equal(state.outbox.filter((entry) => entry.state === "queued").length, 2);
  const facts = state.answer ? { state: state.answer.state, connection: state.answer.connection, live: state.answer.live, stale: state.answer.stale, predicted: state.answer.predicted, site: state.answer.site, reason: state.answer.reason, hydrating: state.answer.state === "hydrating", rows: Array.isArray(state.answer.data) ? state.answer.data.length : null, twin: state.twin } : null;
  assert.ok((state.answer?.predicted ?? []).includes(queued[0].intent), `predicted intent must be on the query result; answer facts: ${JSON.stringify(facts)}; outbox: ${JSON.stringify(state.outbox.map((entry) => ({ state: entry.state, predicted: entry.predicted, intent: entry.intent })))}`);
  assert.ok(state.answer.data.some((row) => row.message?.body === "offline first"), "queued send must be inside the never-opened query's data");
  assert.ok(state.bubbles.some((bubble) => bubble.key === queued[0].ids[0] && bubble.kind === "pending"));
  for (const room of seed.rooms) assert.ok(state.coverage.rows.some((row) => row.table === "deliveries" && row.row.conversationId === room));
}
async function coldMedia() {
  const ordinary = await command("view", { assetId: seed.assets[0].id });
  assert.equal(ordinary.loaded, true); assert.match(ordinary.uri, /^file:\/\//);
  const once = await command("view", { assetId: seed.assets[1].id, hidden: true });
  assert.equal(once.viewed, true); assert.equal(once.loaded, false); assert.equal(once.uri, undefined); assert.deepEqual(once.files, []);
  // Check the actual container as well as the application's report.
  const container = (await run("xcrun", ["simctl", "get_app_container", device, bundleId, "data"])).trim();
  const { walk } = await import("./expo-project.mjs");
  const files = await walk(resolve(container, "Library/Caches/snapback2"));
  assert.ok(files.some((path) => path.includes(seed.assets[0].id)));
  assert.ok(files.every((path) => !path.includes(seed.assets[1].id)));
  const clip = await command("view", { assetId: seed.assets[2].id, hidden: true });
  assert.equal(clip.refusal, undefined); assert.equal(clip.viewed, true);
  assert.equal(clip.loaded, false); assert.equal(clip.uri, undefined); assert.deepEqual(clip.files, []);
  await assertNoMediaOnDisk(container, seed.forbidden);
  return { ordinary, once, clip };
}

const actions = [
  async () => {
    // Probe before creating the project so a denied Simulator service is explicit.
    const inventory = JSON.parse(await run("xcrun", ["simctl", "list", "devices", "available", "--json"], { timeout: 20_000 }));
    const desired = process.env.SNAPBACK2_EXPO_SIMULATOR ?? "iPhone 17";
    const match = Object.values(inventory.devices).flat().find((entry) => entry.name === desired || entry.udid === desired);
    if (!match) throw new Error(`available iOS simulator not found: ${desired}`);
    device = match.udid;
    if (match.state !== "Booted") await run("xcrun", ["simctl", "boot", device]);
    await run("xcrun", ["simctl", "bootstatus", device, "-b"]);
    control = await controlServer(controlPort);
    const { cli } = await prepareExpoProject();
    owner = await ownerHarness(ownerPort); await owner.start(); seed = await seedWitness(owner.directUrl);
    // SDK 54 uses --device for simulators too; --simulator is not an Expo flag.
    const buildEnv = { ...environment, EXPO_PUBLIC_SNAPBACK_URL: owner.url, EXPO_PUBLIC_SNAPBACK_WITNESS: `ws://localhost:${controlPort}` };
    const build = await run(process.execPath, [cli, "run:ios", "--device", device, "--configuration", "Release", "--no-bundler"], { cwd: project, env: buildEnv, timeout: 1_200_000 });
    await writeFile(resolve(workspace, "target/e2-witness-ios-build.log"), build);
    // run:ios may auto-launch; record that process via launch before killing it.
    await launch(false); await killApp();
    return { device, xcode: (await run("xcodebuild", ["-version"])).trim(), build: "target/e2-witness-ios-build.log", seed: { rooms: seed.rooms, doomed: seed.doomed, assets: seed.assets, once: seed.once } };
  },
  async () => {
    await launch(); await command("construct", { fresh: true, name: "alice", once: seed.once, assets: seed.assets });
    await command("drain");
    for (const conversationId of seed.rooms.slice(0, 3)) await command("open", { conversationId });
    for (const [index, asset] of seed.assets.entries()) {
      log(`view ${index + 1}/${seed.assets.length}: ${"duration" in asset ? "video" : "image"}`);
      const media = await command("view", { assetId: asset.id });
      if ("duration" in asset) {
        assert.equal(media.refusal, undefined); assert.equal(media.viewed, true);
        assert.equal(media.loaded, true); assert.equal(media.playing, true);
        assert.match(media.uri, /^data:video\/mp4;base64,/); assert.deepEqual(media.files, []);
        continue;
      }
      assert.equal(media.loaded, true, JSON.stringify(media));
      assert.match(media.uri, index === 0 ? /^file:\/\// : /^data:/);
    }
    const container = (await run("xcrun", ["simctl", "get_app_container", device, bundleId, "data"])).trim();
    await assertNoMediaOnDisk(container, seed.forbidden);
    return { opened: seed.rooms.slice(0, 3), neverOpened: seed.rooms[3] };
  },
  async () => {
    await command("offline");
    queued = [await command("send", { conversationId: seed.rooms[3], body: "offline first" }),
      await command("send", { conversationId: seed.rooms[3], body: "offline second" })];
    assert.ok(queued.every((result) => result.state === "queued"));
    return queued;
  },
  async () => {
    await command("swap", { phase: "pre" }); before = await command("state");
    await command("barrier", { mode: "on" });
    const pending = command("swap", { phase: "post" }).catch((error) => error.message);
    await control.event("barrier reached"); await killApp(); await pending;
    await owner.stop(); await launch(); coldStores(await command("stores")); await command("construct");
    const state = await command("state", { conversationId: seed.rooms[3] }); coldAssertions(state);
    // A query with truly absent coverage is separate from the never-opened chat.
    const absent = await command("state", { conversationId: "never-held-conversation" });
    assert.equal(absent.answer.state, "partial");
    return { stores: Object.fromEntries(Object.entries(state.stores).map(([key, rows]) => [key, rows.length])), media: await coldMedia() };
  },
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000)); await killApp(); await launch(); coldStores(await command("stores")); await command("construct");
    coldAssertions(await command("state", { conversationId: seed.rooms[3] })); return coldMedia();
  },
  async () => {
    await command("fault", { mode: "carrier" }); await killApp(); await launch();
    await assert.rejects(command("construct"), (error) => error.envelope?.code === "E_OFFLINE_CARRIER");
    await command("fault", { mode: "none" }); await command("construct"); return "E_OFFLINE_CARRIER over live control; recovery passed";
  },
  async () => {
    await owner.start(); owner.inject503(); await command("online");
    const settled = await command("settled");
    assert.equal(owner.injected, 1);
    const entries = settled.filter((entry) => queued.some((item) => item.intent === entry.intent));
    assert.equal(entries.length, 2); assert.ok(entries.every((entry) => entry.state === "committed"));
    const sends = owner.replays.filter((entry) => queued.some((item) => item.intent === entry.replay.intent));
    assert.deepEqual(sends[0], sends[1], "lost response retries byte-identically");
    assert.equal(sends.at(-1).replay.intent, queued[1].intent);
    const { createClient, api } = await import(resolve(dist, "client.mjs"));
    const server = createClient({ url: owner.directUrl, as: "alice" });
    try {
      const answer = await server.query(api.deliveries.thread, { conversationId: seed.rooms[3], c: null });
      for (let i = 0; i < queued.length; i++) assert.equal(answer.data.filter((row) => row.messageId === entries[i].ids[0]).length, 1, "one server row and the same bubble key");
    } finally { await server.close(); }
    const state = await command("state", { conversationId: seed.rooms[3] });
    assert.ok(state.bubbles.some((bubble) => bubble.key === queued[0].ids[0] && bubble.kind === "row"), "the same bubble key becomes the server row");
    return { intents: entries.map((entry) => ({ intent: entry.intent, id: entry.ids[0], state: entry.state })), injected: owner.injected };
  },
  async () => {
    await command("offline");
    assert.equal((await command("state", { conversationId: seed.rooms[0], search: "expires while offline" })).search.length, 1);
    const { createClient, api } = await import(resolve(dist, "client.mjs"));
    const server = createClient({ url: owner.directUrl, as: "alice" });
    try { assert.equal((await server.mutation(api.witness.expire, { messageId: seed.doomed })).state, "committed"); }
    finally { await server.close(); }
    await command("online");
    await command("offline"); // Search the held answer, after resume applied the expiry.
    const state = await command("state", { conversationId: seed.rooms[0], search: "expires while offline" });
    assert.ok(state.coverage.rows.every((row) => row.table !== "messages" || row.id !== seed.doomed));
    assert.ok(state.answer.data.every((row) => row.message?.body !== "expires while offline"));
    assert.equal(state.search.length, 0);
    return { removed: seed.doomed };
  },
  async () => {
    const result = await command("conformance", {}, 60_000);
    assert.equal(result.journalMode, "wal"); assert.equal(result.checks.length, 10);
    assert.ok(result.checks.includes("body-ended transaction rejects and next transaction succeeds"));
    return { ...result, nativeCommitFailure: "unqualified: this probe ends the transaction in its body" };
  },
  async () => {
    await command("online"); await killApp(); await launch(); await command("construct"); await command("drain");
    const entries = await command("settled"); assert.ok(entries.every((entry) => entry.state !== "queued"));
    return { queueDrained: true };
  },
];

export async function main() {
  let failure;
  try {
    for (let i = 0; i < actions.length; i++) {
      if (failure) { steps.push({ step: i + 1, name: names[i], result: "not run", reason: `step ${failure.step} failed` }); log(`${i + 1}. NOT RUN — ${names[i]} (step ${failure.step} failed)`); continue; }
      try {
        const detail = await actions[i](); steps.push({ step: i + 1, name: names[i], result: "pass", detail });
        log(`${i + 1}. PASS — ${names[i]} — ${JSON.stringify(detail)}`);
      } catch (error) {
        failure = { step: i + 1, message: String(error) }; steps.push({ step: i + 1, name: names[i], result: "fail", error: failure.message });
        log(`${i + 1}. FAIL — ${names[i]}\n${failure.message}`);
      }
    }
  } finally {
    if (appPid) await killApp().catch(() => {});
    await control?.close(); await owner?.close();
  }
  const record = { date: new Date().toISOString(), platform: "ios", steps };
  await mkdir(resolve(workspace, "target"), { recursive: true });
  await writeFile(resolve(workspace, "target/e2-witness-result.json"), JSON.stringify(record, null, 2) + "\n");
  if (failure) {
    // One bounded, updatable ticket for this scheduled witness, not one per run.
    const ticket = resolve(workspace, "../issues/20260904-snapback2-expo-witness.md");
    await writeFile(ticket, `# Snapback 2 Expo witness needs qualification\n\nStatus: Open\n\nLast run: ${record.date}\nFailing step: ${failure.step} — ${names[failure.step - 1]}\n\n\`\`\`\n${failure.message}\n\`\`\`\n\nRun \`cd snapback2 && node scripts/witness-expo.mjs\` outside the sandbox. Success requires all ten steps; see \`target/e2-witness-result.json\`. Android and Expo web remain outside E2.\n`);
    process.exitCode = 1;
  }
}
if (process.argv.includes("--print-launchd")) {
  const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  log(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.snapback.expo-witness</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(fileURLToPath(import.meta.url))}</string></array><key>WorkingDirectory</key><string>${xml(workspace)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string></dict><key>StartInterval</key><integer>21600</integer><key>StandardOutPath</key><string>${xml(workspace)}/target/expo-witness-schedule.log</string><key>StandardErrorPath</key><string>${xml(workspace)}/target/expo-witness-schedule.log</string></dict></plist>`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
