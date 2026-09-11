#!/usr/bin/env node
// @ref LLP 1013#7-the-simulator-witness — scheduled native evidence, never a push gate.
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { binary, workspace, project, dist, environment, prepareExpoProject, run } from "./expo-project.mjs";
import { controlServer } from "./witness-expo/control.mjs";
import { assertNoMediaOnDisk } from "./witness-expo/container.mjs";
import { ownerHarness, seedWitness } from "./witness-expo/owner.mjs";

const names = ["build, owner seed, and outward control", "login, inbox drain, three chats, two photos and warm indexed search", "offline and two queued sends",
  "SIGKILL at barrier; exact pre-swap state across all five stores and twin prediction", "SIGKILL at rest; same cold state",
  "persistent carrier fault reports over control", "post-commit 503, exactly-once replay and FIFO",
  "Unicode indexed prediction and expiry agree warm and held", "Expo driver conformance and transaction rollback checks", "persist online, relaunch and drain"];
const steps = [];
const mediaFailures = [];
let control, owner, device, appPid, seed, before, queued;
const bundleId = "dev.snapback.chat";
const controlPort = 43219, ownerPort = 43220;
const indexedSearchTerm = "CAFE\u0301";
const log = (text) => process.stdout.write(`${text}\n`);
const command = (...args) => control.command(...args);
async function buildAndInstall(cli, buildEnv) {
  const ios = resolve(project, "ios");
  const derived = resolve(workspace, "target/e2-expo-derived");
  const prebuild = await run(process.execPath, [cli, "prebuild", "--platform", "ios", "--no-install"],
    { cwd: project, env: buildEnv, timeout: 300_000 });
  const pods = await run("pod", ["install"], { cwd: ios, env: buildEnv, timeout: 600_000 });
  const workspaceName = (await readdir(ios)).find((name) => name.endsWith(".xcworkspace"));
  if (!workspaceName) throw new Error(`Expo prebuild did not create an Xcode workspace under ${ios}`);
  const workspaceFile = resolve(ios, workspaceName);
  const scheme = workspaceName.slice(0, -".xcworkspace".length);
  const xcode = await run("xcodebuild", ["-workspace", workspaceFile, "-scheme", scheme,
    "-configuration", "Release", "-destination", `id=${device}`, "-derivedDataPath", derived,
    "-jobs", "4", "ONLY_ACTIVE_ARCH=YES", "build"], {
    cwd: ios, env: { ...buildEnv, RCT_NO_LAUNCH_PACKAGER: "true" }, timeout: 1_200_000,
  });
  const products = resolve(derived, "Build/Products/Release-iphonesimulator");
  const apps = (await readdir(products)).filter((name) => name.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`expected one simulator app in ${products}, found ${JSON.stringify(apps)}`);
  const app = resolve(products, apps[0]);
  await run("xcrun", ["simctl", "install", device, app], { timeout: 60_000 });
  return ["## expo prebuild", prebuild, "## pod install", pods, "## xcodebuild", xcode,
    `## installed\n${app}`].join("\n");
}
async function mediaCheck(step, name, body) {
  try { return { name, result: await body() }; }
  catch (error) {
    const failure = { step, name, message: String(error) };
    mediaFailures.push(failure); log(`${step}. MEDIA FAIL — ${name}\n${failure.message}`);
    return { name, error: failure.message };
  }
}
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
  const queryFacts = (answer) => answer ? {
    state: answer.state, connection: answer.connection, live: answer.live,
    stale: answer.stale, predicted: answer.predicted, site: answer.site,
    reason: answer.reason, data: Array.isArray(answer.data) ? answer.data.map((row) => ({
      id: row.id, conversationId: row.conversationId, body: row.body,
      messageId: row.message?.id, messageBody: row.message?.body,
    })) : null,
  } : null;
  const facts = { answer: queryFacts(state.answer), search: queryFacts(state.search),
    conversationView: state.conversationView ? {
      state: state.conversationView.state, connection: state.conversationView.connection,
      live: state.conversationView.live, predicted: state.conversationView.predicted,
      reason: state.conversationView.reason, site: state.conversationView.site,
      data: state.conversationView.data,
    } : null,
    searchVariants: Object.fromEntries(Object.entries(state.searchVariants ?? {}).map(([name, answer]) => [name, queryFacts(answer)])),
    searchProbe: state.searchProbe, twin: state.twin,
    roomCoverage: state.coverage.rows.filter((row) => row.row?.conversationId === seed.rooms[3]) };
  assert.ok((state.answer?.predicted ?? []).some((row) => row.intent === queued[0].intent
    && row.table === "messages" && row.id === queued[0].ids[0]), `predicted row must be on the query result; answer facts: ${JSON.stringify(facts)}; outbox: ${JSON.stringify(state.outbox.map((entry) => ({ state: entry.state, predicted: entry.predicted, intent: entry.intent })))}`);
  assert.ok(state.answer.data.some((row) => row.message?.body === "Café offline first"), "queued send must be inside the never-opened query's data");
  assert.ok(state.bubbles.some((bubble) => bubble.key === queued[0].ids[0] && bubble.kind === "pending"));
  assert.equal(state.conversationView.state, "partial", "missing count authority keeps the whole composite partial");
  assert.equal(state.composed?.timedOut, false, `the composed observation settled: ${JSON.stringify(state.composed)}`);
  assert.equal(state.composed?.itemsFrom, "history", `the Thread's composed observation lends items from history: ${JSON.stringify(state.composed)}`);
  assert.equal(state.composed?.history?.status, "ready", "the declared history is readable while the composite is partial");
  assert.ok(state.composed?.keys.includes(queued[0].ids[0]), "the queued send is among the composed items");
  assert.equal(state.search.state, "held");
  assert.ok(state.search.data.some((row) => row.id === queued[0].ids[0] && row.body === "Café offline first"),
    `cold indexed search includes the predicted message row; query facts: ${JSON.stringify(facts)}; expected: ${JSON.stringify({ id: queued[0].ids[0], body: "Café offline first", intent: queued[0].intent })}; outbox: ${JSON.stringify(state.outbox.map((entry) => ({ state: entry.state, predicted: entry.predicted, intent: entry.intent, ids: entry.ids })))}`);
  for (const room of seed.rooms) assert.ok(state.coverage.rows.some((row) => row.table === "deliveries" && row.row.conversationId === room));
}
async function coldMedia(step) {
  const results = [];
  results.push(await mediaCheck(step, "cold ordinary image", async () => {
    const ordinary = await command("view", { assetId: seed.assets[0].id });
    assert.equal(ordinary.loaded, true); assert.match(ordinary.uri, /^file:\/\//); return ordinary;
  }));
  results.push(await mediaCheck(step, "cold view-once image", async () => {
    const once = await command("view", { assetId: seed.assets[1].id, hidden: true });
    assert.equal(once.viewed, true); assert.equal(once.loaded, false); assert.equal(once.uri, undefined); assert.deepEqual(once.files, []); return once;
  }));
  results.push(await mediaCheck(step, "cold ordinary video", async () => {
    const clip = await command("view", { assetId: seed.assets[2].id });
    assert.equal(clip.refusal, undefined); assert.equal(clip.viewed, false);
    assert.equal(clip.loaded, true); assert.match(clip.uri, /^file:\/\//); return clip;
  }));
  results.push(await mediaCheck(step, "cold container custody", async () => {
    const container = (await run("xcrun", ["simctl", "get_app_container", device, bundleId, "data"])).trim();
    const { walk } = await import("./expo-project.mjs");
    const files = await walk(resolve(container, "Library/Caches/snapback2"));
    assert.ok(files.some((path) => path.includes(seed.assets[0].id)));
    assert.ok(files.every((path) => !path.includes(seed.assets[1].id)));
    await assertNoMediaOnDisk(container, seed.forbidden); return files;
  }));
  return results;
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
    const buildEnv = { ...environment, NODE_BINARY: process.execPath, EXPO_PUBLIC_SNAPBACK_URL: owner.url,
      EXPO_PUBLIC_SNAPBACK_WITNESS: `ws://localhost:${controlPort}` };
    // Expo's run:ios unconditionally asks Simulator.app to activate after a
    // successful build. Scheduled witnesses build and install through the same
    // generated native project without requiring GUI automation permission.
    const build = await buildAndInstall(cli, buildEnv);
    await writeFile(resolve(workspace, "target/e2-witness-ios-build.log"), build);
    await launch(false); await killApp();
    return { device, xcode: (await run("xcodebuild", ["-version"])).trim(), build: "target/e2-witness-ios-build.log", seed: { rooms: seed.rooms, doomed: seed.doomed, assets: seed.assets } };
  },
  async () => {
    await launch(); await command("construct", { fresh: true, name: "alice", assets: seed.assets });
    await command("drain");
    const views = [];
    for (const conversationId of seed.rooms.slice(0, 3)) views.push(await command("open", { conversationId }));
    assert.ok(views.every((view) => (view.state === "complete" || view.state === "capped") && view.sameValue
      && JSON.stringify(view.consumers) === JSON.stringify([2, 1])
      && JSON.stringify(view.next) === JSON.stringify([null, null])),
    `conversation-view convergence mismatch: ${JSON.stringify(views)}`);
    const warmSearch = await command("state", { search: indexedSearchTerm });
    assert.ok(warmSearch.search.state === "complete" || warmSearch.search.state === "capped");
    assert.ok(warmSearch.search.data.some((row) => row.id === seed.doomed));
    const media = [];
    for (const [index, asset] of seed.assets.entries()) media.push(await mediaCheck(2,
      `warm ${"duration" in asset ? "video" : "image"} ${index + 1}/${seed.assets.length}`, async () => {
        const result = await command("view", { assetId: asset.id });
        if ("duration" in asset) {
          assert.equal(result.refusal, undefined); assert.equal(result.viewed, false);
          assert.equal(result.loaded, true); assert.equal(result.playing, true); assert.match(result.uri, /^file:\/\//);
        } else {
          assert.equal(result.loaded, true, JSON.stringify(result)); assert.match(result.uri, index === 0 ? /^file:\/\// : /^data:/);
        }
        return result;
      }));
    await mediaCheck(2, "warm container custody", async () => {
      const container = (await run("xcrun", ["simctl", "get_app_container", device, bundleId, "data"])).trim();
      await assertNoMediaOnDisk(container, seed.forbidden); return container;
    });
    return { opened: seed.rooms.slice(0, 3), neverOpened: seed.rooms[3], coherentViews: views.map((view) => ({
      consumers: view.consumers, next: view.next, count: view.data.count,
      preview: view.data.preview[0]?.message?.body,
    })), search: warmSearch.search.state, media };
  },
  async () => {
    await command("offline");
    queued = [await command("send", { conversationId: seed.rooms[3], body: "Café offline first" }),
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
    const state = await command("state", { conversationId: seed.rooms[3], search: indexedSearchTerm, searchDiagnostics: true }); coldAssertions(state);
    // A query with truly absent coverage is separate from the never-opened chat.
    const absent = await command("state", { conversationId: "never-held-conversation" });
    assert.equal(absent.answer.state, "partial");
    const probe = state.searchProbe ?? {};
    const searchProbe = { runtime: probe.runtime, postings: Object.fromEntries(Object.entries(probe.postings ?? {}).map(([term, value]) =>
      [term, { token: value.token, counts: value.scopes.map((scope) => scope.ids.length) }])) };
    return { stores: Object.fromEntries(Object.entries(state.stores).map(([key, rows]) => [key, rows.length])),
      searchProbe, media: await coldMedia(4) };
  },
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    // Step 4 intentionally constructed and exercised the client after proving
    // the raw pre-swap recovery. Step 5 owns a new at-rest baseline immediately
    // before its kill so ordinary completed activity cannot masquerade as a
    // torn durable write.
    before = await command("stores"); await killApp(); await launch(); coldStores(await command("stores")); await command("construct");
    coldAssertions(await command("state", { conversationId: seed.rooms[3], search: indexedSearchTerm })); return coldMedia(5);
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
    const server = createClient({ url: owner.directUrl, persona: "alice" });
    try {
      const answer = await server.query(api.messages.thread, { conversationId: seed.rooms[3], c: null });
      for (let i = 0; i < queued.length; i++) assert.equal(answer.data.filter((row) => row.messageId === entries[i].ids[0]).length, 1, "one server row and the same bubble key");
    } finally { await server.close(); }
    const state = await command("state", { conversationId: seed.rooms[3] });
    assert.ok(state.bubbles.some((bubble) => bubble.key === queued[0].ids[0] && bubble.kind === "row"), "the same bubble key becomes the server row");
    return { intents: entries.map((entry) => ({ intent: entry.intent, id: entry.ids[0], state: entry.state })), injected: owner.injected };
  },
  async () => {
    const warm = await command("state", { conversationId: seed.rooms[0], search: indexedSearchTerm });
    assert.ok(warm.search.state === "complete" || warm.search.state === "capped");
    assert.ok(warm.search.data.some((row) => row.id === seed.doomed));
    assert.ok(warm.search.data.some((row) => row.id === queued[0].ids[0]), "the settled prediction remains indexed");
    await command("offline");
    const held = await command("state", { conversationId: seed.rooms[0], search: indexedSearchTerm });
    assert.equal(held.search.state, "held");
    assert.ok(held.search.data.some((row) => row.id === seed.doomed));
    const { createClient, api } = await import(resolve(dist, "client.mjs"));
    const server = createClient({ url: owner.directUrl, persona: "alice" });
    try { assert.equal((await server.mutation(api.witness.expire, { messageId: seed.doomed })).state, "committed"); }
    finally { await server.close(); }
    await command("online");
    await command("offline"); // Search the held answer, after resume applied the expiry.
    const state = await command("state", { conversationId: seed.rooms[0], search: indexedSearchTerm });
    assert.ok(state.coverage.rows.every((row) => row.table !== "messages" || row.id !== seed.doomed));
    assert.ok(state.answer.data.every((row) => row.message?.body !== "Café expires while offline"));
    assert.equal(state.search.state, "held");
    assert.ok(state.search.data.every((row) => row.id !== seed.doomed));
    assert.ok(state.search.data.some((row) => row.id === queued[0].ids[0]));
    return { removed: seed.doomed, preserved: queued[0].ids[0], search: state.search.state };
  },
  async () => {
    const result = await command("conformance", {}, 60_000);
    assert.equal(result.journalMode, "wal"); assert.equal(result.checks.length, 10);
    assert.ok(result.checks.includes("real COMMIT failure rolls back and next transaction succeeds"));
    return { ...result, nativeCommitFailure: "qualified: SDK-owned COMMIT refused after the body, left no row, and the next transaction succeeded" };
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
        const beforeMedia = mediaFailures.length;
        const detail = await actions[i]();
        const media = mediaFailures.slice(beforeMedia);
        steps.push({ step: i + 1, name: names[i], result: media.length ? "fail" : "pass", detail, ...(media.length ? { errors: media } : {}) });
        log(`${i + 1}. ${media.length ? "FAIL" : "PASS"} — ${names[i]} — ${JSON.stringify(detail)}`);
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? String(error) : String(error);
        failure = { step: i + 1, message }; steps.push({ step: i + 1, name: names[i], result: "fail", error: failure.message });
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
  const finalFailure = [failure, ...mediaFailures].filter(Boolean).sort((a, b) => a.step - b.step)[0];
  if (finalFailure) {
    // One bounded, updatable ticket for this scheduled witness, not one per run.
    const ticket = resolve(workspace, "../issues/20260904-snapback2-expo-witness.md");
    await writeFile(ticket, `# Snapback 2 Expo witness needs qualification\n\nStatus: Open\n\nLast run: ${record.date}\nFailing step: ${finalFailure.step} — ${names[finalFailure.step - 1]}\n\n\`\`\`\n${finalFailure.message}\n\`\`\`\n\nRun \`cd snapback2 && node scripts/witness-expo.mjs\` outside the sandbox. Success requires all ten steps; see \`target/e2-witness-result.json\`. Android and Expo web remain outside E2.\n`);
    process.exitCode = 1;
  }
}
if (process.argv.includes("--print-launchd")) {
  const xml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  log(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>com.snapback.expo-witness</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(fileURLToPath(import.meta.url))}</string></array><key>WorkingDirectory</key><string>${xml(workspace)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH ?? "/usr/bin:/bin")}</string></dict><key>StartInterval</key><integer>21600</integer><key>StandardOutPath</key><string>${xml(workspace)}/target/expo-witness-schedule.log</string><key>StandardErrorPath</key><string>${xml(workspace)}/target/expo-witness-schedule.log</string></dict></plist>`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
