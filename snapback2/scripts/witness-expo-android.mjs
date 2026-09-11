#!/usr/bin/env node
// @ref LLP 1013#7-the-simulator-witness — targeted Android media evidence complements the full iOS durability witness.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  binary, environment, prepareExpoProject, project, run, walk, workspace,
} from "./expo-project.mjs";
import { controlServer } from "./witness-expo/control.mjs";
import { ownerHarness, seedWitness } from "./witness-expo/owner.mjs";

const bundleId = "dev.snapback.chat";
const controlPort = 43219;
const ownerPort = 43220;
const expectedAvd = process.env.SNAPBACK2_ANDROID_AVD ?? "Snapback_API_36_1";
const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
if (!sdk) throw new Error("set ANDROID_SDK_ROOT or ANDROID_HOME to the Android SDK");
const adb = resolve(sdk, "platform-tools/adb");

async function adbRun(device, args, timeout = 60_000) {
  return run(adb, ["-s", device, ...args], { timeout });
}

async function connectedDevice() {
  const rows = (await run(adb, ["devices"])).split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row.length === 2 && row[1] === "device");
  if (rows.length !== 1) throw new Error(`expected one connected Android device, found ${JSON.stringify(rows)}`);
  const device = rows[0][0];
  const avd = (await adbRun(device, ["emu", "avd", "name"])).split("\n")[0].trim();
  if (avd !== expectedAvd) throw new Error(`expected AVD ${expectedAvd}, found ${avd}`);
  const [sdkLevel, release, fingerprint] = await Promise.all([
    adbRun(device, ["shell", "getprop", "ro.build.version.sdk"]),
    adbRun(device, ["shell", "getprop", "ro.build.version.release"]),
    adbRun(device, ["shell", "getprop", "ro.build.fingerprint"]),
  ]);
  assert.equal(sdkLevel.trim(), "36", "the API 36.1 image must report SDK 36");
  return { device, avd, sdk: sdkLevel.trim(), release: release.trim(), fingerprint: fingerprint.trim() };
}

async function buildAndInstall(device, cli, buildEnv) {
  const prebuild = await run(process.execPath,
    [cli, "prebuild", "--platform", "android", "--no-install"],
    { cwd: project, env: buildEnv, timeout: 300_000 });
  const manifestPath = resolve(project, "android/app/src/main/AndroidManifest.xml");
  const manifest = await readFile(manifestPath, "utf8");
  const applications = manifest.match(/<application\b/g) ?? [];
  assert.equal(applications.length, 1, "the generated witness app must have one Android application");
  const cleartext = manifest.match(/<application\b[^>]*android:usesCleartextTraffic="([^"]+)"/);
  if (cleartext) assert.equal(cleartext[1], "true",
    "the generated witness manifest must not reject its localhost control channels");
  // The disposable witness reaches only adb-reversed localhost HTTP/WebSocket servers.
  if (!cleartext) {
    await writeFile(manifestPath, manifest.replace(
      /<application\b/,
      '<application android:usesCleartextTraffic="true"',
    ));
  }
  const gradle = await run(resolve(project, "android/gradlew"),
    [":app:assembleRelease", "--no-daemon"],
    { cwd: resolve(project, "android"), env: buildEnv, timeout: 1_200_000 });
  const outputs = resolve(project, "android/app/build/outputs/apk/release");
  const apks = (await walk(outputs)).filter((path) => path.endsWith(".apk"));
  if (apks.length !== 1) throw new Error(`expected one release APK under ${outputs}, found ${JSON.stringify(apks)}`);
  await adbRun(device, ["install", "-r", apks[0]], 180_000);
  return { log: ["## expo prebuild", prebuild, "## gradle", gradle, `## installed\n${apks[0]}`].join("\n"), apk: apks[0] };
}

async function main() {
  let control;
  let owner;
  let device;
  const record = { date: new Date().toISOString(), platform: "android", result: "fail" };
  try {
    const target = await connectedDevice();
    device = target.device;
    await adbRun(device, ["shell", "setprop", "debug.sf.luma_sampling", "0"]);
    assert.equal((await adbRun(device, ["shell", "getprop", "debug.sf.luma_sampling"])).trim(), "0",
      "the API 36.1 emulator must disable its broken software-rendered luma sampling path");
    control = await controlServer(controlPort);
    await run("cargo", ["build", "-p", "snapback2"], { cwd: workspace, timeout: 600_000 });
    await run(process.execPath, ["packages/snapback2/build.mjs"], { cwd: workspace });
    const { cli } = await prepareExpoProject();
    owner = await ownerHarness(ownerPort);
    await owner.start();
    const seed = await seedWitness(owner.directUrl);
    const buildEnv = {
      ...environment,
      NODE_BINARY: process.execPath,
      EXPO_PUBLIC_SNAPBACK_URL: owner.url,
      EXPO_PUBLIC_SNAPBACK_WITNESS: `ws://localhost:${controlPort}`,
    };
    const built = await buildAndInstall(device, cli, buildEnv);
    await writeFile(resolve(workspace, "target/e2-witness-android-build.log"), built.log);
    await adbRun(device, ["reverse", `tcp:${controlPort}`, `tcp:${controlPort}`]);
    await adbRun(device, ["reverse", `tcp:${ownerPort}`, `tcp:${ownerPort}`]);
    const generation = control.generation;
    await adbRun(device, ["shell", "am", "force-stop", bundleId]);
    // Avoid API 36.1's broken ranchu task-thumbnail readback on headless arm64 hosts.
    await adbRun(device, ["shell", "am", "start", "--activity-exclude-from-recents",
      "--activity-no-history", "--activity-no-animation", "-n", `${bundleId}/.MainActivity`]);
    await control.connected(generation);
    await control.command("construct", { fresh: true, name: "alice", assets: seed.assets });
    await control.command("drain");
    let diagnosticTimer;
    const diagnostics = new Promise((_, reject) => {
      diagnosticTimer = setTimeout(() => {
        void control.command("state").then(
          (state) => reject(new Error(`Android image load did not settle: ${JSON.stringify({
            snapshot: state.snapshot, files: state.files, media: state.media,
          })}`)),
          reject,
        );
      }, 20_000);
    });
    const ordinary = await Promise.race([
      control.command("view", { assetId: seed.assets[0].id }, 30_000), diagnostics,
    ]).finally(() => clearTimeout(diagnosticTimer));
    assert.equal(ordinary.loaded, true, JSON.stringify(ordinary));
    assert.equal(ordinary.viewed, false);
    assert.match(ordinary.uri, /^file:\/\//);
    assert.ok(ordinary.files.some((path) => path.includes(seed.assets[0].id)), JSON.stringify(ordinary));
    Object.assign(record, { result: "pass", target, apk: built.apk, ordinary });
    process.stdout.write(`PASS Android ordinary image — ${JSON.stringify(record)}\n`);
  } catch (error) {
    record.error = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`FAIL Android ordinary image\n${record.error}\n`);
    process.exitCode = 1;
  } finally {
    if (device) {
      await adbRun(device, ["shell", "am", "force-stop", bundleId]).catch(() => {});
      await adbRun(device, ["reverse", "--remove", `tcp:${controlPort}`]).catch(() => {});
      await adbRun(device, ["reverse", "--remove", `tcp:${ownerPort}`]).catch(() => {});
    }
    await control?.close();
    await owner?.close();
    await mkdir(resolve(workspace, "target"), { recursive: true });
    await writeFile(resolve(workspace, "target/e2-witness-android-result.json"), `${JSON.stringify(record, null, 2)}\n`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
